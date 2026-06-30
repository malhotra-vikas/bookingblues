import Link from 'next/link';

import { ApiError, apiAsUser } from '../../../../lib/api';

interface Conversation {
  id: string;
  caller_phone_e164: string;
  status: string;
  outcome: string | null;
  summary: string | null;
  started_at: string;
  last_message_at: string | null;
}

interface Message {
  id: string;
  role: 'caller' | 'bot' | 'system';
  body: string;
  created_at: string;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;

  let data: { conversation: Conversation; messages: Message[] } | null = null;
  let error: string | null = null;
  try {
    data = await apiAsUser<{ conversation: Conversation; messages: Message[] }>(
      `/v1/conversations/${id}/messages`,
    );
  } catch (err) {
    error = err instanceof ApiError ? err.message : 'Could not load conversation';
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="text-sm text-accent no-underline hover:underline">
          ← Back to dashboard
        </Link>
      </div>

      {error || !data ? (
        <p className="text-sm text-red-600">Couldn&apos;t load this conversation: {error ?? 'not found'}</p>
      ) : (
        <>
          <header className="rounded-lg border border-slate-200 bg-white p-4">
            <h1 className="font-display text-xl font-semibold text-ink">
              Conversation with {data.conversation.caller_phone_e164}
            </h1>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>Status: {data.conversation.status}</span>
              <span>Outcome: {data.conversation.outcome ?? '—'}</span>
              <span>Started: {fmt(data.conversation.started_at)}</span>
            </div>
            {data.conversation.summary ? (
              <p className="mt-3 text-sm text-ink">{data.conversation.summary}</p>
            ) : null}
          </header>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-ink">Messages</h2>
            {data.messages.length === 0 ? (
              <p className="text-sm text-muted">No messages in this conversation.</p>
            ) : (
              <ul className="space-y-2">
                {data.messages.map((m) => {
                  const isCaller = m.role === 'caller';
                  const isSystem = m.role === 'system';
                  return (
                    <li
                      key={m.id}
                      className={`flex ${isCaller ? 'justify-start' : isSystem ? 'justify-center' : 'justify-end'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                          isSystem
                            ? 'bg-slate-100 text-muted italic text-xs'
                            : isCaller
                              ? 'bg-slate-100 text-ink'
                              : 'bg-accent text-white'
                        }`}
                      >
                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                        <div
                          className={`mt-1 text-[10px] ${isCaller || isSystem ? 'text-muted' : 'text-white/70'}`}
                        >
                          {isCaller ? 'Caller' : isSystem ? 'System' : 'AI'} · {fmt(m.created_at)}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
