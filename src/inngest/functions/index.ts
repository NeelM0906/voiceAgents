import { handleInboundSms } from './handle-inbound-sms.js';
import { notifyOwner } from './notify-owner.js';
import { sendFollowupSms } from './send-followup-sms.js';
import { sendReviewRequest } from './send-review-request.js';
import { summarizeCall } from './summarize-call.js';
import { syncConversationToCrm } from './sync-conversation-to-crm.js';

export const functions = [
  handleInboundSms,
  notifyOwner,
  sendFollowupSms,
  sendReviewRequest,
  summarizeCall,
  syncConversationToCrm,
];
