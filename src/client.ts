import WebSocket from 'ws';
import { Bot } from './bot';
import { WSMessage } from './types';
import { catchException, logger, systemName, systemVersion } from './utils';
import { Client, configure, createClient } from 'tdl';
import type * as Td from 'tdlib-types';
import { getTdjson } from 'prebuilt-tdlib';

let bot: Bot;
let ws: WebSocket;
let pingInterval;

logger.debug(`SERVER: ${process.env.SERVER}`);
logger.debug(`TELEGRAM_PHONE_NUMBER: ${process.env.TELEGRAM_PHONE_NUMBER}`);
logger.debug(`TELEGRAM_TOKEN: ${process.env.TELEGRAM_TOKEN}`);
logger.debug(`CONFIG: ${process.env.CONFIG}`);

const close = () => {
  logger.warn(`Close server`);
  ws.terminate();
  process.exit();
};

process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
process.on('exit', () => {
  logger.warn(`Exit process`);
});

const config = JSON.parse(process.env.CONFIG);

configure({ tdjson: getTdjson() });
const client: Client = createClient({
  apiId: config.apiKeys.telegramAppId,
  apiHash: config.apiKeys.telegramApiHash,
  databaseDirectory: `${process.cwd()}/data/${config.name}/database`,
  databaseEncryptionKey: config.apiKeys.databaseEncryptionKey,
  filesDirectory: `${process.cwd()}/data/${config.name}/files`,
  skipOldUpdates: true,
  verbosityLevel: 1,
  tdlibParameters: {
    application_version: 'latest',
    system_language_code: config.locale,
    device_model: systemName(),
    system_version: systemVersion(),
  },
});

client.on('update', async (update: Td.Update) => {
  // logger.info(JSON.stringify(update, null, 4));
  if (update._ == 'updateNewMessage') {
    if (update.message.is_outgoing) {
      if (update.message.is_channel_post) {
        if (update.message.content._ == 'messageText') {
          return;
        }
      } else {
        return;
      }
    }
    if (bot.user && !bot.user.isBot) {
      await bot.serverRequest('openChat', {
        chat_id: update.message.chat_id,
      });
      await bot.serverRequest('viewMessages', {
        chat_id: update.message.chat_id,
        message_ids: [update.message.id],
        force_read: true,
      });
    }
    if (update.message) {
      const msg = await bot.convertMessage(update.message);
      if (msg) {
        const data: WSMessage = {
          bot: 'polaris',
          platform: 'telegram',
          type: 'message',
          message: msg,
        };
        ws.send(JSON.stringify(data));
      } else {
        logger.error(`convertMessage error, original message: ${JSON.stringify(update.message)}`);
      }
    }
  }
});

client.on('error', console.error);

const poll = () => {
  logger.info('Starting polling...');
  ws = new WebSocket(process.env.SERVER);
  bot = new Bot(ws, client);

  clearInterval(pingInterval);
  pingInterval = setInterval(() => {
    bot.ping();
  }, 30000);

  ws.on('error', async (error: WebSocket.ErrorEvent) => {
    if (error['code'] === 'ECONNREFUSED') {
      logger.info(`Waiting for server to be available...`);
      setTimeout(poll, 5000);
    } else {
      logger.error(error);
    }
  });

  ws.on('open', async () => await bot.init());

  ws.on('close', async (code) => {
    await client.invoke({
      _: 'setOption',
      name: 'online',
      value: {
        _: 'optionValueBoolean',
        value: false
      }
    });
    if (code === 1005) {
      logger.warn(`Disconnected`);
    } else if (code === 1006) {
      logger.warn(`Terminated`);
    }
    clearInterval(pingInterval);
    process.exit();
  });

  ws.on('message', (data: string) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type !== 'pong') {
        logger.info(JSON.stringify(msg, null, 4));
      }
      if (msg.type === 'message') {
        bot.sendMessage(msg.message);
      }
    } catch (error) {
      catchException(error);
    }
  });
};

poll();
