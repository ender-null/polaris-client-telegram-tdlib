import { Config } from './config';

export interface ApiKeys {
  telegramPhoneNumber?: string;
  telegramBotToken?: string;
  telegramApiHash?: string;
  telegramAppId?: number;
  databaseEncryptionKey?: string;
  discordBotToken?: string;
  discordClientId?: number;
  blizzardClientId?: string;
  blizzardClientSecret?: string;
  catApi?: string;
  giphy?: string;
  googleDeveloperConsole?: string;
  lastfm?: string;
  openWeather?: string;
  tenor?: string;
  riotApi?: string;
  wolframAlpha?: string;
  matrixAccessToken?: string;
  matrixHomeserverUrl?: string;
  matrixUsername?: string;
  matrixPassword?: string;
  facebookPageAccessToken?: string;
  facebookVerifyToken?: string;
  twitterConsumerKey?: string;
  twitterConsumerSecret?: string;
  twitterAccessTokenKey?: string;
  twitterAccessTokenSecret?: string;
}

export interface Instance {
  translation?: string;
  bindings?: string;
  owner?: string;
  adminConversationId?: string;
  alertsConversationId?: string;
  plugins?: string | string[];
  apiKeys?: ApiKeys;
}

export abstract class Command {
  command?: string;
  friendly?: string;
  shortcut?: string;
  aliases?: string[];
  parameters?: Parameter[];
  hidden?: boolean;
  description?: string;
  keepDefault?: boolean;
  skipHelp?: boolean;
  alwaysEnabled?: boolean;

  constructor() {
    this.friendly = null;
    this.shortcut = null;
    this.parameters = null;
    this.hidden = false;
    this.description = null;
    this.keepDefault = false;
    this.alwaysEnabled = false;
  }
}

export abstract class Parameter {
  name: string;
  required: boolean;
}

export class User {
  id: number | string;
  firstName: string;
  lastName: string;
  username: string;
  isBot: boolean;

  constructor(id: number | string, firstName?: string, lastName?: string, username?: string, isBot = false) {
    this.id = id;
    this.firstName = firstName;
    this.lastName = lastName;
    this.username = username;
    this.isBot = isBot;
  }
}

export class Conversation {
  id: number | string;
  title: string;

  constructor(id: number | string, title?: string) {
    this.id = id;
    this.title = title;
  }
}

export class ConversationInfo extends Conversation {}

export class Message {
  id: number | string;
  conversation: Conversation;
  sender: User | Conversation;
  content: string;
  type: string;
  date: number;
  reply: Message;
  extra: Extra;

  constructor(
    id: number | string,
    conversation: Conversation,
    sender: User | Conversation,
    content: string,
    type?: string,
    date?: number,
    reply?: Message,
    extra?: Extra,
  ) {
    this.id = id;
    this.conversation = conversation;
    this.sender = sender;
    this.content = content;
    this.type = type;
    this.date = date;
    this.reply = reply;
    this.extra = extra;
  }
}

export class HTTPResponseError extends Error {
  response: Response;
  constructor(response: Response) {
    super(`Failed HTTP request to '${response.url}' with status ${response.status} (${response.statusText})`);
    this.response = response;
  }
}

export interface Extra {
  originalMessage?: any;
  input?: string;
  inputReply?: string;
  addPing?: boolean;
  format?: string;
  preview?: boolean;
  caption?: string;
  message?: number | string;
  title?: string;
  description?: string;
  photo?: string;
  conversation?: number | string;
  commands?: string;
  stickerSetName?: string;
  messageId?: number | string;
  userId?: number | string;
  fromChatId?: number | string;
  customTitle?: string;
  urls?: string[];
  mentions?: string[];
  hashtags?: string[];
  viaBotUserId?: number | string;
  restrictionReason?: string;
  replyMarkup?: any;
}

export class BroadcastMessage {
  conversation: Conversation;
  content: string;
  type: string;
  extra: Extra;

  constructor(conversation: Conversation, content: string, type?: string, extra?: Extra) {
    this.conversation = conversation;
    this.content = content;
    this.type = type;
    this.extra = extra;
  }
}

export interface PluginParameter {
  name: string;
  description: string;
  type?: 'string' | 'number' | 'boolean' | 'file';
  required?: boolean;
  translations?: Record<string, string>;
}

export interface PluginIntent {
  id: string;
  aliases?: string[];
  description: string;
  parameters?: Record<string, PluginParameter>;
  requiredApiKey?: string;
  examples?: string[];
  entities?: string[];
}

export interface WSData {
  bot: string;
  platform: string;
  type: string;
}

export interface WSInit extends WSData {
  type: 'init';
  user: User;
  config: Config;
}

export interface WSMessage extends WSData {
  type: 'message';
  message: Message;
}

export interface WSPing extends WSData {
  type: 'ping';
}

export interface WSBroadcast extends WSData {
  type: 'broadcast';
  target: string | string[];
  message: BroadcastMessage;
}

export interface WSCommandPayload {
  [id: string]: string | number | boolean;
}
