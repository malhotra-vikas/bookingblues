import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import WebSocket, { WebSocketServer } from 'ws';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

import { VoiceBridge } from './voice-bridge';
import { VOICE_STREAM_PATH, VoiceCallService } from './voice-call.service';
import { verifyVoiceToken } from './voice-session-token';

interface TwilioStart {
  readonly event: 'start';
  readonly start?: {
    readonly streamSid?: string;
    readonly callSid?: string;
    readonly customParameters?: Record<string, string>;
  };
}

/**
 * WebSocket endpoint for Twilio Media Streams, attached to the API's own HTTP
 * server (the spike runs in the API process; a separate service later so a
 * deploy doesn't cut live calls). Nothing is trusted until the `start` message
 * carries a valid token for that exact CallSid.
 */
@Injectable()
export class VoiceStreamGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private wss: WebSocketServer | null = null;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly voiceCalls: VoiceCallService,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.logger.setContext(VoiceStreamGateway.name);
  }

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter?.getHttpServer() as
      | { on(event: 'upgrade', cb: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): void }
      | undefined;
    if (!server) return;
    const wss = new WebSocketServer({ noServer: true });
    this.wss = wss;
    server.on('upgrade', (req, socket, head) => {
      const path = (req.url ?? '').split('?')[0];
      if (path !== VOICE_STREAM_PATH) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
    });
  }

  onApplicationShutdown(): void {
    this.wss?.close();
  }

  private onConnection(twilioWs: WebSocket): void {
    let bridge: VoiceBridge | null = null;
    let starting = false;

    twilioWs.on('message', (data) => {
      const raw = data.toString();
      if (bridge) {
        bridge.onTwilioMessage(raw);
        return;
      }
      if (starting) return; // caller audio before the bridge is up is dropped (greeting hasn't played)
      let msg: { event?: string };
      try {
        msg = JSON.parse(raw) as { event?: string };
      } catch {
        return;
      }
      if (msg.event !== 'start') return;
      starting = true;
      this.attach(twilioWs, msg as TwilioStart)
        .then((b) => {
          bridge = b;
        })
        .catch((err: Error) => {
          this.logger.error({ err: err.message }, 'voice stream attach failed');
          twilioWs.close();
        });
    });
    twilioWs.on('close', () => bridge?.onTwilioClose());
    twilioWs.on('error', (err) => this.logger.warn({ err: err.message }, 'twilio stream socket error'));
  }

  private async attach(twilioWs: WebSocket, msg: TwilioStart): Promise<VoiceBridge | null> {
    const callSid = msg.start?.callSid ?? '';
    const streamSid = msg.start?.streamSid ?? '';
    const operatorId = verifyVoiceToken({
      token: msg.start?.customParameters?.token,
      callSid,
      secret: this.env.TWILIO_AUTH_TOKEN ?? '',
    });
    if (!operatorId || !streamSid) {
      this.logger.warn({ callSid }, 'voice stream rejected: bad or missing token');
      twilioWs.close();
      return null;
    }

    const pending = this.voiceCalls.claim(callSid);
    if (!pending) {
      this.logger.error({ callSid, operatorId }, 'voice stream has no prepared call; falling back to IVR');
      await this.voiceCalls.fallbackToIvr(callSid, operatorId, 'no_prepared_call');
      twilioWs.close();
      return null;
    }

    let prepared;
    try {
      prepared = await pending;
    } catch (err) {
      await this.voiceCalls.fallbackToIvr(callSid, operatorId, `prepare_failed: ${(err as Error).message}`);
      twilioWs.close();
      return null;
    }

    const bridge = new VoiceBridge(twilioWs, prepared.openai, this.voiceCalls.hooksFor(prepared), {
      greeting: prepared.greeting,
      maxCallSeconds: this.env.VOICE_MAX_CALL_SECONDS,
    });
    prepared.openai.on('message', (data) => bridge.onOpenAIMessage(data.toString()));
    prepared.openai.on('close', () => bridge.onOpenAIClose());
    prepared.openai.on('error', (err) =>
      this.logger.error({ callSid, err: err.message }, 'openai realtime socket error'),
    );
    bridge.start(streamSid);
    return bridge;
  }
}
