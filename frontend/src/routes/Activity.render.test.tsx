import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../api/cache';
import { setActiveCity } from '../api/cityBase';
import { AttentionProvider } from '../attention/context';
import { createAttentionContributors } from '../attention/registry';
import { NowProvider } from '../contexts/NowContext';
import type { SupervisorEventItem } from '../supervisor/eventReads';
import { ActivityPage } from './Activity';

const fetchUrls: string[] = [];

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    fetchUrls.push(url);

    if (url === '/api/git/commits?view=recent-main') {
      return jsonResponse({
        view: 'recent-main',
        items: [{
          sha: 'abcdef123456',
          short_sha: 'abcdef1',
          subject: 'Keep project activity visible',
          author: 'Chris',
          date: '2026-06-01T10:00:00Z',
          refs: null,
        }],
      });
    }
    if (url === '/api/builds') {
      return jsonResponse({
        items: [{
          at: '2026-06-01T10:05:00Z',
          status: 'ok',
          detail: 'build passed',
        }],
        source: null,
        failed_marker: false,
      });
    }
    if (url === '/gc-supervisor/v0/city/test-city/events?limit=100&since=24h') {
      return jsonResponse({
        items: [
          {
            actor: 'supervisor',
            message: 'session crashed while applying patch',
            payload: {
              reason: 'panic',
              session_id: 'gc-session-1',
              template: 'mayor',
            },
            seq: 42,
            subject: 'gc-session-1',
            ts: '2026-06-01T10:10:00Z',
            type: 'session.crashed',
          },
          {
            actor: 'mayor',
            message: 'request failed',
            payload: {
              error_code: 'submit_failed',
              error_message: 'session unavailable',
              operation: 'session.submit',
              request_id: 'req-1',
            },
            seq: 41,
            subject: 'req-1',
            ts: '2026-06-01T10:09:00Z',
            type: 'request.failed',
          },
        ],
        total: 2,
      });
    }
    if (url === '/gc-supervisor/v0/city/test-city/events?limit=100&since=24h&type=session.crashed') {
      return jsonResponse({
        items: [
          {
            actor: 'supervisor',
            message: 'session crashed while applying patch',
            payload: {
              reason: 'panic',
              session_id: 'gc-session-1',
              template: 'mayor',
            },
            seq: 42,
            subject: 'gc-session-1',
            ts: '2026-06-01T10:10:00Z',
            type: 'session.crashed',
          },
        ],
        total: 1,
      });
    }
    if (url === '/gc-supervisor/v0/city/test-city/events?limit=100&since=1h') {
      return jsonResponse({
        items: [
          {
            actor: 'supervisor',
            message: 'event archive rotated',
            payload: {
              prior_archive: '/tmp/events-1.jsonl',
              prior_first_seq: 1,
              prior_last_seq: 40,
            },
            seq: 43,
            subject: 'events',
            ts: '2026-06-01T10:10:00Z',
            type: 'events.rotated',
          },
        ],
        total: 1,
      });
    }

    throw new Error(`unexpected fetch: ${url}`);
  }));
}

beforeEach(() => {
  fetchUrls.length = 0;
  invalidate('');
  setActiveCity('test-city');
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ActivityPage supervisor events', () => {
  it('loads a supervisor event timeline directly from the generated supervisor API', async () => {
    renderActivityPage();

    await screen.findByText('Keep project activity visible');
    fireEvent.click(screen.getByRole('button', { name: 'Supervisor events' }));

    expect(await screen.findByText('session.crashed')).toBeTruthy();
    expect(screen.getByText('request.failed')).toBeTruthy();
    expect(screen.getByText('session crashed while applying patch')).toBeTruthy();
    expect(fetchUrls).toContain('/gc-supervisor/v0/city/test-city/events?limit=100&since=24h');
    expect(fetchUrls.some((url) => url.startsWith('/api/city/test-city/events'))).toBe(false);

    fireEvent.change(screen.getByLabelText('Filter supervisor events'), {
      target: { value: 'request' },
    });

    expect(screen.queryByText('session.crashed')).toBeNull();
    expect(screen.getByText('request.failed')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter supervisor events'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Last 1h' }));

    expect(await screen.findByText('events.rotated')).toBeTruthy();
    expect(fetchUrls).toContain('/gc-supervisor/v0/city/test-city/events?limit=100&since=1h');
  });

  it('honors deep-linked supervisor event type filters through the generated supervisor query', async () => {
    renderActivityPage('/activity?mode=events&type=session.crashed');

    expect(await screen.findByText('session.crashed')).toBeTruthy();
    expect(screen.queryByText('request.failed')).toBeNull();
    expect(fetchUrls).toContain('/gc-supervisor/v0/city/test-city/events?limit=100&since=24h&type=session.crashed');
    expect((screen.getByLabelText('Event type filter') as HTMLInputElement).value).toBe('session.crashed');
  });

  it('highlights supervisor event rows that match Activity attention facts', async () => {
    const event = supervisorEvent({
      seq: 42,
      type: 'session.crashed',
      message: 'session crashed while applying patch',
      subject: 'gc-session-1',
    });

    renderActivityPage('/activity?mode=events', {
      events: [event],
    });

    const eventType = await screen.findByText('session.crashed');
    const row = eventType.closest('tr');
    expect(row?.getAttribute('data-attention-severity')).toBe('attention');
  });
});

function renderActivityPage(
  initialEntry = '/',
  options: { events?: readonly SupervisorEventItem[] } = {},
) {
  const contributors = createAttentionContributors(
    options.events === undefined ? {} : { activity: { events: options.events } },
  );
  render(
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <NowProvider intervalMs={1_000_000}>
        <AttentionProvider contributors={contributors}>
          <ActivityPage />
        </AttentionProvider>
      </NowProvider>
    </MemoryRouter>,
  );
}

function requestUrl(input: RequestInfo | URL): string {
  const url = input instanceof Request
    ? input.url
    : input instanceof URL
      ? input.toString()
      : String(input);
  return stripSameOrigin(url);
}

function stripSameOrigin(url: string): string {
  const origin = window.location.origin;
  return url.startsWith(origin) ? url.slice(origin.length) : url;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function supervisorEvent(overrides: Partial<SupervisorEventItem>): SupervisorEventItem {
  return {
    actor: 'supervisor',
    message: 'event message',
    payload: {
      reason: 'panic',
      session_id: 'gc-session-1',
      template: 'mayor',
    },
    seq: 1,
    subject: 'gc-session-1',
    ts: '2026-06-01T10:10:00Z',
    type: 'session.crashed',
    ...overrides,
  } as SupervisorEventItem;
}
