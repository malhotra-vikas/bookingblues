import { Module } from '@nestjs/common';

import { SlackApiClient } from '../slack/slack-api.client';

import { LeadsController } from './leads.controller';

@Module({
  controllers: [LeadsController],
  providers: [SlackApiClient],
})
export class LeadsModule {}
