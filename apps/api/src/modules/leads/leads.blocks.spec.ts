import { buildLeadBlocks } from './leads.controller';

const base = {
  userId: '11111111-1111-1111-1111-111111111111',
  email: 'op@example.com',
  businessName: 'Zeus Electrical',
  phoneE164: '+14155551234',
  adminUrl: 'https://keeprsteady.com/admin/leads',
};

type Block = { type?: string; block_id?: string; elements?: Array<{ action_id?: string }> };

function actionIds(blocks: ReadonlyArray<unknown>): string[] {
  return (blocks as Block[])
    .filter((b) => b.type === 'actions')
    .flatMap((b) => (b.elements ?? []).map((e) => e.action_id ?? ''));
}

describe('buildLeadBlocks', () => {
  it('renders a claimable lead with the Claim button by default', () => {
    const blocks = buildLeadBlocks(base);
    expect(actionIds(blocks)).toContain('lead_claim');
    expect(JSON.stringify(blocks)).not.toContain('Pre-assigned');
  });

  it('renders a pre-assigned lead with NO claim button + a lock banner', () => {
    const blocks = buildLeadBlocks({ ...base, preassignedSlackUserId: 'U0B1AJTVA9J' });
    // No actions block at all → can't be claimed by anyone else.
    expect(actionIds(blocks)).toHaveLength(0);
    const json = JSON.stringify(blocks);
    expect(json).toContain(':lock:');
    expect(json).toContain('<@U0B1AJTVA9J>');
    expect(json).toContain('Pre-assigned');
  });
});
