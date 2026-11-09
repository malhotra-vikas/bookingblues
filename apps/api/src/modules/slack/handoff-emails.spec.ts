import { botHandoffEmailContent, handoffEmails } from './handoff-emails';

const base = {
  businessName: 'Jamal Insurance',
  callerPhoneE164: '+18483458488',
  conversationId: '3823ee2f-0000-4000-8000-000000000000',
  operatorId: 'fa2e2ccc-2601-43a1-8ed6-f40c8c71f2fa',
  appUrl: 'https://keeprsteady.com',
};

describe('handoffEmails', () => {
  const emails = handoffEmails({
    ...base,
    content: {
      operator: { why: 'Your Google Calendar is connected without permission.', steps: ['Reconnect Google Calendar.'] },
      admin: { why: "Jamal Insurance's calendar lacks permission.", steps: ['Ask them to reconnect.'], technical: 'book step · external.google 403' },
    },
  });

  it('operator: full caller number, reply step first, their own steps, link to the conversation', () => {
    expect(emails.operator.subject).toBe('A caller needs a reply: (848) 345-8488');
    expect(emails.operator.text).toContain('Caller: (848) 345-8488');
    expect(emails.operator.text).toContain('1. Call or text the caller at (848) 345-8488');
    expect(emails.operator.text).toContain('2. Reconnect Google Calendar.');
    expect(emails.operator.text).toContain(`https://keeprsteady.com/conversations/${base.conversationId}`);
    expect(emails.operator.text).toContain('someone will reach out shortly');
    expect(emails.operator.text).not.toContain('Technical');
  });

  it('admin: last 4 only, Slack step first, technical note, link to the operator in admin', () => {
    expect(emails.admin.subject).toBe('[HITL] Jamal Insurance: caller •••8488 needs a human');
    expect(emails.admin.text).not.toContain('345-8488');
    expect(emails.admin.text).toContain('1. Pick it up from the alert in Slack #hitl');
    expect(emails.admin.text).toContain('2. Ask them to reconnect.');
    expect(emails.admin.text).toContain('Technical: book step · external.google 403');
    expect(emails.admin.text).toContain(`https://keeprsteady.com/admin/operators/${base.operatorId}`);
  });

  it('escapes HTML from free text (model-written reasons)', () => {
    const e = handoffEmails({ ...base, content: botHandoffEmailContent('<script>x</script> & stuff') });
    expect(e.operator.html).not.toContain('<script>');
    expect(e.operator.html).toContain('&lt;script&gt;');
  });
});
