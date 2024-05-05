/* eslint-disable @typescript-eslint/no-explicit-any */
import WebSocket from 'ws';
import { Conversation, Extra, Message, User, WSBroadcast, WSInit, WSPing } from './types';
import { Config } from './config';
import { catchException, fromBase64, isInt, logger, sendRequest, splitLargeMessage } from './utils';
import type * as Td from 'tdlib-types';
import { Client } from 'tdl';
import { ParsedUrlQueryInput } from 'querystring';

export class Bot {
  user: User;
  config: Config;
  websocket: WebSocket;
  bot: Client;

  constructor(websocket: WebSocket, bot: Client) {
    this.websocket = websocket;
    this.bot = bot;
  }

  async init() {
    if (process.env.TELEGRAM_PHONE_NUMBER) {
      await this.bot.login(() => ({
        getPhoneNumber: (retry) =>
          retry ? Promise.reject('Invalid phone number') : Promise.resolve(process.env.TELEGRAM_PHONE_NUMBER),
      }));
    } else if (process.env.TELEGRAM_TOKEN) {
      await this.bot.loginAsBot(process.env.TELEGRAM_TOKEN);
    }
    const me = await this.bot.invoke({
      _: 'getMe',
    });
    await this.bot.invoke({
      _: 'setOption',
      name: 'online',
      value: {
        _: 'optionValueBoolean',
        value: true,
      },
    });
    this.user = {
      id: me.id,
      firstName: me.first_name,
      lastName: null,
      username: me.usernames.active_usernames[0],
      isBot: me.type._ === 'userTypeBot',
    };
    this.config = JSON.parse(process.env.CONFIG);
    const data: WSInit = {
      bot: me.usernames[0],
      platform: 'telegram',
      type: 'init',
      user: this.user,
      config: this.config,
    };
    this.websocket.send(JSON.stringify(data, null, 4));
    logger.info(`Connected as @${data.user.username}`);
  }

  ping() {
    logger.debug('ping');
    const data: WSPing = {
      bot: this.user.username,
      platform: 'telegram',
      type: 'ping',
    };
    this.websocket.send(JSON.stringify(data, null, 4));
  }

  broadcast(target: string | string[], chatId: string, content: string, type: string, extra?: Extra) {
    const data: WSBroadcast = {
      bot: this.user.username,
      platform: 'telegram',
      type: 'broadcast',
      target: target,
      message: {
        conversation: new Conversation(chatId),
        content,
        type,
        extra,
      },
    };
    this.websocket.send(JSON.stringify(data, null, 4));
  }

  async convertMessage(msg: Td.Message) {
    const id = msg.id;
    const extra: Extra = {
      originalMessage: msg,
    };

    const rawChat: Td.Chat = await this.serverRequest('getChat', { chat_id: msg.chat_id });
    const conversation = new Conversation(msg.chat_id);
    let sender = null;
    if (rawChat && rawChat.title) {
      conversation.title = rawChat.title;
    }
    if (msg.sender_id._ === 'messageSenderUser') {
      const rawSender: Td.User = await this.serverRequest('getUser', { user_id: msg.sender_id.user_id });
      sender = new User(msg.sender_id.user_id);
      if (rawSender) {
        if (rawSender.first_name) {
          sender.firstName = String(rawSender.first_name);
        }
        if (rawSender.last_name) {
          sender.lastName = String(rawSender.last_name);
        }
        if (rawSender.usernames) {
          sender.username = String(rawSender.usernames.active_usernames[0]);
        }
      }
    } else {
      sender = new Conversation(conversation.id, conversation.title);
    }

    let content;
    let type;

    if (msg.content._ == 'messageText') {
      content = msg.content.text.text;
      type = 'text';
      if (Array.isArray(msg.content.text.entities)) {
        for (const entity of msg.content.text.entities) {
          if (entity.type._ == 'textEntityTypeUrl') {
            if (!Array.isArray(extra.urls)) {
              extra.urls = [];
            }
            extra.urls.push(content.slice(entity.offset, entity.offset + entity.length));
          }
          if (entity.type._ == 'textEntityTypeMention') {
            if (!Array.isArray(extra.mentions)) {
              extra.mentions = [];
            }
            extra.mentions.push(content.slice(entity.offset, entity.offset + entity.length));
          }
          if (entity.type._ == 'textEntityTypeMentionName') {
            if (!Array.isArray(extra.mentions)) {
              extra.mentions = [];
            }
            extra.mentions.push(entity['user_id']);
          }
          if (entity.type._ == 'textEntityTypeHashtag') {
            if (!Array.isArray(extra.hashtags)) {
              extra.hashtags = [];
            }
            extra.hashtags.push(content.slice(entity.offset, entity.offset + entity.length));
          }
        }
      }
    } else if (msg.content._ == 'messagePhoto') {
      content = msg.content.photo.sizes[0].photo.remote.id;
      type = 'photo';
      if (msg.content.caption) {
        extra.caption = msg.content.caption.text;
      }
    } else if (msg.content._ == 'messageAnimation') {
      content = msg.content.animation.animation.remote.id;
      type = 'animation';
      if (msg.content.caption) {
        extra.caption = msg.content.caption.text;
      }
    } else if (msg.content._ == 'messageDocument') {
      content = msg.content.document.document.remote.id;
      type = 'document';
      if (msg.content.caption) {
        extra.caption = msg.content.caption.text;
      }
    } else if (msg.content._ == 'messageAudio') {
      content = msg.content.audio.audio.remote.id;
      type = 'audio';
      if (msg.content.caption) {
        extra.caption = msg.content.caption.text;
      }
    } else if (msg.content._ == 'messageVideo') {
      content = msg.content.video.video.remote.id;
      type = 'video';
      if (msg.content.caption) {
        extra.caption = msg.content.caption.text;
      }
    } else if (msg.content._ == 'messageVoiceNote') {
      content = msg.content.voice_note.voice.remote.id;
      type = 'voice';
      if (msg.content.caption) {
        extra.caption = msg.content.caption.text;
      }
    } else if (msg.content._ == 'messageSticker') {
      content = msg.content.sticker.sticker.remote.id;
      type = 'sticker';
    } else if (msg.content._ == 'messageUnsupported') {
      content = 'Message content that is not supported by the client';
      type = 'unsupported';
    } else {
      content = msg.content._;
      type = 'unsupported';
    }

    let reply: Message = null;
    if (msg.reply_to != undefined && msg.reply_to._ === 'messageReplyToMessage') {
      reply = await this.getMessage(msg.chat_id, msg.reply_to.message_id);
    }
    if (msg.via_bot_user_id != undefined && msg.via_bot_user_id > 0) {
      extra.viaBotUserId = msg.via_bot_user_id;
    }
    if (msg.restriction_reason != undefined && msg.restriction_reason != '') {
      extra.restrictionReason = msg.restriction_reason;
    }
    if (msg.reply_markup != undefined) {
      extra.replyMarkup = msg.reply_markup;
    }
    const date = msg['date'];
    return new Message(id, conversation, sender, content, type, date, reply, extra);
  }

  async sendChatAction(conversationId: number | string, type = 'text'): Promise<any> {
    let action = 'chatActionTyping';

    if (type == 'photo') {
      action = 'chatActionUploadingPhoto';
    } else if (type == 'document') {
      action = 'chatActionUploadingDocument';
    } else if (type == 'video') {
      action = 'chatActionUploadingVideo';
    } else if (type == 'voice' || type == 'audio') {
      action = 'chatActionRecordingVoiceNote';
    } else if (type == 'location' || type == 'venue') {
      action = 'chatActionChoosingLocation';
    } else if (type == 'cancel') {
      action = 'chatActionCancel';
    }

    return await this.serverRequest(
      'sendChatAction',
      {
        chat_id: conversationId,
        action: { _: action },
      },
      true,
    );
  }

  async sendMessage(msg: Message): Promise<void> {
    await this.sendChatAction(+msg.conversation.id, msg.type);
    let data = null;
    let inputMessageContent = null;
    let preview = false;
    if (msg.extra && 'preview' in msg.extra) {
      preview = msg.extra.preview;
    }

    if (msg.type == 'text') {
      if (!msg.content || (typeof msg.content == 'string' && msg.content.length == 0)) {
        return;
      }
      inputMessageContent = {
        _: 'inputMessageText',
        text: {
          _: 'formattedText',
          text: msg.content,
          entities: [],
        },
        disable_web_page_preview: !preview,
      };
    } else if (msg.type == 'photo') {
      inputMessageContent = {
        _: 'inputMessagePhoto',
        photo: await this.getInputFile(msg.content),
        disable_web_page_preview: !preview,
      };

      if (msg.extra && 'caption' in msg.extra) {
        inputMessageContent['caption'] = {
          _: 'formattedText',
          text: msg.extra.caption,
        };
      }
    } else if (msg.type == 'animation') {
      inputMessageContent = {
        _: 'inputMessageAnimation',
        animation: await this.getInputFile(msg.content),
        disable_web_page_preview: !preview,
      };

      if (msg.extra && 'caption' in msg.extra) {
        inputMessageContent['caption'] = {
          _: 'formattedText',
          text: msg.extra.caption,
        };
      }
    } else if (msg.type == 'audio') {
      inputMessageContent = {
        _: 'inputMessageAudio',
        audio: await this.getInputFile(msg.content),
        disable_web_page_preview: !preview,
      };

      if (msg.extra && 'caption' in msg.extra) {
        inputMessageContent['caption'] = {
          _: 'formattedText',
          text: msg.extra.caption,
          disable_web_page_preview: !preview,
        };
      }
    } else if (msg.type == 'document') {
      inputMessageContent = {
        _: 'inputMessageDocument',
        document: await this.getInputFile(msg.content),
        disable_web_page_preview: !preview,
      };

      if (msg.extra && 'caption' in msg.extra) {
        inputMessageContent['caption'] = {
          _: 'formattedText',
          text: msg.extra.caption,
        };
      }
    } else if (msg.type == 'sticker') {
      inputMessageContent = {
        _: 'inputMessageSticker',
        sticker: await this.getInputFile(msg.content),
        disable_web_page_preview: !preview,
      };

      if (msg.extra && 'caption' in msg.extra) {
        inputMessageContent['caption'] = {
          _: 'formattedText',
          text: msg.extra.caption,
        };
      }
    } else if (msg.type == 'video') {
      inputMessageContent = {
        _: 'inputMessageVideo',
        video: await this.getInputFile(msg.content),
        disable_web_page_preview: !preview,
      };

      if (msg.extra && 'caption' in msg.extra) {
        inputMessageContent['caption'] = {
          _: 'formattedText',
          text: msg.extra.caption,
        };
      }
    } else if (msg.type == 'voice') {
      inputMessageContent = {
        _: 'inputMessageVoiceNote',
        voice_note: await this.getInputFile(msg.content),
        disable_web_page_preview: !preview,
      };

      if (msg.extra && 'caption' in msg.extra) {
        inputMessageContent['caption'] = {
          _: 'formattedText',
          text: msg.extra.caption,
        };
      }
    } else if (msg.type == 'forward') {
      data = {
        _: 'forwardMessages',
        chat_id: msg.extra.conversation,
        from_chat_id: msg.conversation.id,
        message_ids: [msg.extra.message],
      };
    } else if (msg.type == 'native') {
      data = {
        _: msg.content,
        chat_id: msg.conversation.id,
      };

      if (msg.extra && 'title' in msg.extra) {
        data.title = msg.extra.title;
      }
      if (msg.extra && 'userId' in msg.extra) {
        data.user_id = msg.extra.userId;
      }

      if (msg.extra && 'customTitle' in msg.extra) {
        data.custom_title = msg.extra.customTitle;
      }

      if (msg.extra && 'photo' in msg.extra) {
        data.photo = await this.getInputFile(msg.extra.photo);
      }

      if (msg.extra && 'description' in msg.extra) {
        data.description = msg.extra.description;
      }

      if (msg.extra && 'messageId' in msg.extra) {
        data.message_id = msg.extra.messageId;
      }

      if (msg.extra && 'stickerSetName' in msg.extra) {
        data.sticker_set_name = msg.extra.stickerSetName;
      }

      if (msg.extra && 'commands' in msg.extra) {
        data.commands = msg.extra.commands;
      }
    } else if (msg.type == 'api') {
      const params: { chat_id?; user_id?; custom_title?; photo?; message_id?; sticker_set_name?; commands? } = {
        chat_id: msg.conversation.id,
      };

      if (msg.extra && 'userId' in msg.extra) {
        params.user_id = msg.extra.userId;
      }

      if (msg.extra && 'customTitle' in msg.extra) {
        params.custom_title = msg.extra.customTitle;
      }

      if (msg.extra && 'photo' in msg.extra) {
        params.photo = msg.extra.photo;
      }

      if (msg.extra && 'messageId' in msg.extra) {
        params.message_id = msg.extra.messageId;
      }

      if (msg.extra && 'stickerSetName' in msg.extra) {
        params.sticker_set_name = msg.extra.stickerSetName;
      }

      if (msg.extra && 'commands' in msg.extra) {
        params.commands = msg.extra.commands;
      }

      await this.apiRequest(msg.content, params);
      await this.sendChatAction(msg.conversation.id, 'cancel');
      return;
    }

    if (inputMessageContent) {
      data = {
        _: 'sendMessage',
        chat_id: msg.conversation.id,
        input_message_content: inputMessageContent,
      };

      if (msg.reply) {
        data.reply_to_message_id = msg.reply.id;
      }
    }

    if (data) {
      if (msg.type == 'text' && data.input_message_content.text.text.length > 4096) {
        const texts = splitLargeMessage(data.input_message_content.text.text, 4096);
        for (const text of texts) {
          const split = { ...data };
          split.input_message_content.text = await this.formatTextEntities(msg, text);
          await this.serverRequest(data._, split, false, true);
        }
      } else {
        if (msg.type == 'text') {
          data.input_message_content.text = await this.formatTextEntities(msg);
        }
        if (msg.extra && 'caption' in msg.extra) {
          data.input_message_content.caption = await this.formatTextEntities(msg);
        }
        await this.serverRequest(data._, data, false, true);
      }
      await this.sendChatAction(+msg.conversation.id, 'cancel');
    }
  }

  async getInputFile(content: string): Promise<Record<string, unknown>> {
    if (content.startsWith('/')) {
      const file = await fromBase64(content);
      return {
        _: 'inputFileLocal',
        path: file.name,
      };
    } else if (content.startsWith('http')) {
      return {
        _: 'inputFileRemote',
        id: content,
      };
    } else if (isInt(content)) {
      return {
        _: 'inputFileId',
        id: content,
      };
    } else {
      return {
        _: 'inputFileRemote',
        id: content,
      };
    }
  }

  async formatTextEntities(msg: Message, text?: string): Promise<any> {
    try {
      if (!text) {
        text = msg.content;
      }
      if (msg.extra && 'format' in msg.extra) {
        let parseMode = null;
        let formattedText = null;

        if (msg.extra.format == 'HTML') {
          parseMode = 'textParseModeHTML';
        } else {
          parseMode = 'textParseModeMarkdown';
        }

        formattedText = await this.serverRequest('parseTextEntities', {
          text: text,
          parse_mode: {
            _: parseMode,
          },
        });

        if (formattedText) {
          return formattedText;
        } else {
          return {
            _: 'formattedText',
            text: text,
            entities: [],
          };
        }
      } else {
        return {
          _: 'formattedText',
          text: text,
          entities: [],
        };
      }
    } catch (error) {
      logger.error(error);
      return {
        _: 'formattedText',
        text: text,
        entities: [],
      };
    }
  }

  async apiRequest(method: string, params: ParsedUrlQueryInput = {}): Promise<Response> {
    const url = `https://api.telegram.org/bot${this.config.apiKeys.telegramBotToken}/${method}`;
    return await sendRequest(url, params, null, null, false);
  }

  async serverRequest(
    method: string,
    params: Record<string, unknown> = {},
    ignoreErrors?: boolean,
    processRequest?: boolean,
    debug?: boolean,
  ): Promise<any> {
    const query: any = {
      _: method,
      ...params,
    };
    if (debug) logger.info(debug);
    return await this.bot.invoke(query).catch(async (e) => {
      if (!ignoreErrors) {
        this.sendAlert(JSON.stringify(query, null, 4));
        catchException(e);
      }
      if (processRequest) {
        await this.requestProcessing(query, e);
      }
    });
  }

  async requestProcessing(request: any, response: any): Promise<any> {
    let otherError = true;

    if (response['message'].toLowerCase() == 'chat not found') {
      logger.info(`Chat not found: ${request['chat_id']}`);
      otherError = false;
    }

    if (response['message'].toLowerCase() == 'user_not_participant') {
      logger.info(`User not participant: ${request['chat_id']}`);
      otherError = false;
    }

    if (
      response['message'].toLowerCase() == 'bad request: file is too big' ||
      response['message'].toLowerCase() == 'invite_hash_expired'
    ) {
      logger.info(response['message']);
      otherError = false;
    }

    if (otherError) {
      this.sendAlert(JSON.stringify(request, null, 4));
      this.sendAlert(JSON.stringify(response, null, 4));
    }
  }

  async getMessage(chatId: string | number, messageId: string | number): Promise<Message> {
    const result = await this.serverRequest(
      'getMessage',
      {
        chat_id: chatId,
        message_id: messageId,
      },
      true,
    );
    if (result) {
      return this.convertMessage(result);
    }

    return null;
  }

  sendAlert(text: string, language = 'javascript'): void {
    if (
      this.config.alertsConversationId &&
      !(text.includes(this.config.alertsConversationId) || text.includes('Chat not found'))
    ) {
      const message = new Message(
        null,
        new Conversation(this.config.alertsConversationId, 'Alerts'),
        this.user,
        `<code class="language-${language}">${text}</code>`,
        'text',
        null,
        null,
        { format: 'HTML', preview: false },
      );
      this.sendMessage(message);
    }
  }

  sendAdminAlert(text: string): void {
    if (
      this.config.adminConversationId &&
      !(text.includes(this.config.adminConversationId) || text.includes('Chat not found'))
    ) {
      const message = new Message(
        null,
        new Conversation(this.config.adminConversationId, 'Admin'),
        this.user,
        text,
        'text',
        null,
        null,
        { format: 'HTML', preview: false },
      );
      this.sendMessage(message);
    }
  }
}
