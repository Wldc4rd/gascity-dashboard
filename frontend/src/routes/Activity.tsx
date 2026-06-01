import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DeployRecord, GitCommit, GitView } from 'gas-city-dashboard-shared';
import { api } from '../api/client';
import { useAttentionModel } from '../attention/context';
import {
  attentionRowProps,
  resourceAttentionSeverity,
} from '../attention/routeHighlight';
import { Button } from '../components/Button';
import { ListSearchBar } from '../components/ListSearchBar';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge, type StatusTone } from '../components/StatusBadge';
import { Table, type TableColumn } from '../components/Table';
import { useNow } from '../contexts/NowContext';
import { useCachedData } from '../hooks/useCachedData';
import { formatRelative } from '../hooks/time';
import {
  listSupervisorEvents,
  type SupervisorEventItem,
  type SupervisorEventList,
  type SupervisorEventQuery,
} from '../supervisor/eventReads';
import { supervisorEventDetail, supervisorEventSignal } from '../supervisor/eventSignals';

const VIEW_OPTIONS: ReadonlyArray<{ value: GitView; label: string }> = [
  { value: 'recent-main', label: 'Recent · main' },
  { value: 'recent-all', label: 'Recent · all' },
  { value: 'today', label: 'Last 24h' },
  { value: 'this-week', label: 'Last 7d' },
];

type ActivityMode = 'events' | 'project';

const MODE_OPTIONS: ReadonlyArray<{ value: ActivityMode; label: string }> = [
  { value: 'project', label: 'Project activity' },
  { value: 'events', label: 'Supervisor events' },
];

const EVENT_WINDOWS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '15m', label: 'Last 15m' },
  { value: '1h', label: 'Last 1h' },
  { value: '24h', label: 'Last 24h' },
];

const EMPTY_EVENTS: SupervisorEventList = {
  items: [],
  total: 0,
};

export function ActivityPage() {
  const attention = useAttentionModel();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = parseActivityMode(searchParams.get('mode'));
  const [view, setView] = useState<GitView>('recent-main');
  const eventWindow = parseEventWindow(searchParams.get('since'));
  const eventType = normalizeQueryValue(searchParams.get('type'));
  const [eventFilter, setEventFilter] = useState('');
  const now = useNow();
  const eventQuery = useMemo<SupervisorEventQuery>(() => {
    const query: SupervisorEventQuery = { since: eventWindow };
    if (eventType.length > 0) query.type = eventType;
    return query;
  }, [eventType, eventWindow]);

  const {
    data: commitsData,
    loading: loadingCommits,
    error: commitsError,
    refresh: refreshCommits,
  } = useCachedData(`commits:${view}`, () => api.listCommits(view));
  const {
    data: deploysData,
    loading: loadingDeploys,
    error: deploysError,
    refresh: refreshDeploys,
  } = useCachedData('builds', () => api.listBuilds());
  const {
    data: eventsData,
    loading: loadingEvents,
    error: eventsError,
    refresh: refreshEvents,
  } = useCachedData(
    `supervisor-events:${mode}:${eventWindow}:${eventType}`,
    () => mode === 'events'
      ? listSupervisorEvents(eventQuery)
      : Promise.resolve(EMPTY_EVENTS),
  );

  const commits = useMemo(() => commitsData?.items ?? [], [commitsData]);
  const deploys = useMemo(() => deploysData?.items ?? [], [deploysData]);
  const events = useMemo(() => eventsData?.items ?? [], [eventsData]);
  const filteredEvents = useMemo(
    () => filterEvents(events, eventFilter),
    [events, eventFilter],
  );
  const deployFailedMarker = deploysData?.failed_marker ?? false;
  const deploySource = deploysData?.source ?? null;
  // Surface whichever fetch most recently errored. Either-or is fine —
  // the operator reads one banner at the top of the page.
  const error = commitsError ?? deploysError ?? eventsError ?? null;

  const commitColumns = useMemo<ReadonlyArray<TableColumn<GitCommit>>>(() => [
    {
      key: 'sha',
      label: 'SHA',
      render: (r) => <span className="text-fg-muted tnum">{r.short_sha}</span>,
      className: 'w-24',
    },
    {
      key: 'subject',
      label: 'Subject',
      sortable: true,
      sortValue: (r) => r.subject,
      render: (r) => (
        <div className="min-w-0">
          <p className="text-fg truncate">{r.subject}</p>
          {r.refs && (
            <p className="text-label uppercase tracking-wider text-accent mt-1 truncate">
              {r.refs}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'author',
      label: 'Author',
      sortable: true,
      sortValue: (r) => r.author,
      render: (r) => <span className="text-fg-muted">{r.author}</span>,
      className: 'w-40',
    },
    {
      key: 'date',
      label: 'When',
      sortable: true,
      sortValue: (r) => r.date,
      render: (r) => <span className="tnum text-fg-muted">{formatRelative(r.date, now)}</span>,
      className: 'w-20',
      align: 'right',
    },
  ], [now]);

  const deployColumns = useMemo<ReadonlyArray<TableColumn<DeployRecord>>>(() => [
    {
      key: 'at',
      label: 'When',
      sortable: true,
      sortValue: (r) => r.at,
      render: (r) => <span className="tnum text-fg-muted">{formatRelative(r.at, now)}</span>,
      className: 'w-24',
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <StatusBadge tone={deployTone(r.status)} label={r.status} />,
      className: 'w-32',
    },
    {
      key: 'detail',
      label: 'Detail',
      render: (r) => (
        <pre className="text-body text-fg-muted whitespace-pre-wrap break-all">
          {r.detail}
        </pre>
      ),
    },
  ], [now]);

  const eventColumns = useMemo<ReadonlyArray<TableColumn<SupervisorEventItem>>>(() => [
    {
      key: 'seq',
      label: 'Seq',
      sortable: true,
      sortValue: (r) => r.seq,
      render: (r) => <span className="text-fg-muted tnum">{r.seq}</span>,
      className: 'w-20',
    },
    {
      key: 'severity',
      label: 'Signal',
      sortable: true,
      sortValue: (r) => eventSeverityRank(r),
      render: (r) => {
        const signal = eventSignal(r);
        return <StatusBadge tone={signal.tone} label={signal.label} />;
      },
      className: 'w-28',
    },
    {
      key: 'type',
      label: 'Type',
      sortable: true,
      sortValue: (r) => r.type,
      render: (r) => <span className="text-fg">{r.type}</span>,
      className: 'w-48',
    },
    {
      key: 'detail',
      label: 'Detail',
      render: (r) => (
        <div className="min-w-0">
          <p className="text-fg truncate">{supervisorEventDetail(r)}</p>
          {r.subject && (
            <p className="text-label uppercase tracking-wider text-fg-faint mt-1 truncate">
              {r.subject}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'actor',
      label: 'Actor',
      sortable: true,
      sortValue: (r) => r.actor,
      render: (r) => <span className="text-fg-muted">{r.actor}</span>,
      className: 'w-36',
    },
    {
      key: 'ts',
      label: 'When',
      sortable: true,
      sortValue: (r) => r.ts,
      render: (r) => <span className="tnum text-fg-muted">{formatRelative(r.ts, now)}</span>,
      className: 'w-24',
      align: 'right',
    },
  ], [now]);
  const deployRowProps = useMemo(
    () => (deploy: DeployRecord) =>
      attentionRowProps(
        resourceAttentionSeverity(attention, 'activity', `deploy:${deploy.at}`),
      ),
    [attention],
  );
  const eventRowProps = useMemo(
    () => (event: SupervisorEventItem) =>
      attentionRowProps(
        resourceAttentionSeverity(attention, 'activity', `event:${event.seq}`),
      ),
    [attention],
  );

  const synopsis = useMemo(
    () => mode === 'events'
      ? buildEventSynopsis(filteredEvents, eventsData?.total ?? 0, eventWindow, eventType)
      : buildSynopsis(commits, deploys, now),
    [commits, deploys, eventsData?.total, eventType, eventWindow, filteredEvents, mode, now],
  );

  const setMode = (nextMode: ActivityMode) => {
    const next = new URLSearchParams(searchParams);
    if (nextMode === 'events') {
      next.set('mode', 'events');
    } else {
      next.delete('mode');
      next.delete('since');
      next.delete('type');
    }
    setSearchParams(next, { replace: true });
  };

  const setEventWindow = (nextWindow: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('mode', 'events');
    if (nextWindow === DEFAULT_EVENT_WINDOW) {
      next.delete('since');
    } else {
      next.set('since', nextWindow);
    }
    setSearchParams(next, { replace: true });
  };

  const setEventType = (nextType: string) => {
    const normalized = nextType.trim();
    const next = new URLSearchParams(searchParams);
    next.set('mode', 'events');
    if (normalized.length === 0) {
      next.delete('type');
    } else {
      next.set('type', normalized);
    }
    setSearchParams(next, { replace: true });
  };

  return (
    <section>
      <PageHeader
        title="Activity"
        synopsis={synopsis}
        meta={
          error ? (
            <span className="normal-case text-body text-accent" role="alert">
              {error}
            </span>
          ) : undefined
        }
      />

      <div className="mb-8 flex items-baseline gap-6">
        {MODE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setMode(opt.value)}
            className={`text-title transition-colors duration-150 ease-out-quart focus-mark rounded-sm ${
              mode === opt.value
                ? 'text-fg font-semibold'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {mode === 'project' ? (
        <>
          <section className="mb-12">
        <header className="flex items-baseline justify-between gap-4 mb-4 pb-2 border-b border-rule flex-wrap">
          <div className="flex items-baseline gap-4 flex-wrap">
            <h2 className="text-headline font-semibold text-fg">Commits</h2>
            <div className="flex items-baseline gap-4">
              {VIEW_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setView(opt.value)}
                  className={`text-label uppercase tracking-wider transition-colors duration-150 ease-out-quart focus-mark rounded-sm ${
                    view === opt.value
                      ? 'text-fg font-medium'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <Button size="sm" onClick={() => void refreshCommits()} disabled={loadingCommits}>
            {loadingCommits ? 'Loading' : 'Refresh'}
          </Button>
        </header>
        <Table
          columns={commitColumns}
          rows={commits}
          rowKey={(r) => r.sha}
          empty="No commits in this view."
          initialSort={{ key: 'date', dir: 'desc' }}
        />
      </section>

          <section>
        <header className="flex items-baseline justify-between gap-4 mb-4 pb-2 border-b border-rule flex-wrap">
          <div className="flex items-baseline gap-4 flex-wrap">
            <h2 className="text-headline font-semibold text-fg">Dev-deploy</h2>
            {deployFailedMarker && <StatusBadge tone="stuck" label="failed marker present" />}
            {deploySource && (
              <span className="text-label uppercase tracking-wider text-fg-faint truncate">
                {deploySource}
              </span>
            )}
          </div>
          <Button size="sm" onClick={() => void refreshDeploys()} disabled={loadingDeploys}>
            {loadingDeploys ? 'Loading' : 'Refresh'}
          </Button>
        </header>
        <Table
          columns={deployColumns}
          rows={deploys}
          rowKey={(r) => `${r.at}-${r.detail.slice(0, 24)}`}
          rowProps={deployRowProps}
          empty="No deploy log entries."
          initialSort={{ key: 'at', dir: 'desc' }}
        />
      </section>
        </>
      ) : (
        <section>
          <header className="flex items-baseline justify-between gap-4 mb-4 pb-2 border-b border-rule flex-wrap">
            <div className="flex items-baseline gap-4 flex-wrap">
              <h2 className="text-headline font-semibold text-fg">Supervisor events</h2>
              <div className="flex items-baseline gap-4">
                {EVENT_WINDOWS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setEventWindow(opt.value)}
                    className={`text-label uppercase tracking-wider transition-colors duration-150 ease-out-quart focus-mark rounded-sm ${
                      eventWindow === opt.value
                        ? 'text-fg font-medium'
                        : 'text-fg-muted hover:text-fg'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <Button size="sm" onClick={() => void refreshEvents()} disabled={loadingEvents}>
              {loadingEvents ? 'Loading' : 'Refresh'}
            </Button>
          </header>
          <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
            <div className="min-w-64 flex-1">
              <ListSearchBar
                value={eventFilter}
                onChange={setEventFilter}
                placeholder="Filter events by type, actor, subject"
                matchCount={filteredEvents.length}
                totalCount={events.length}
                ariaLabel="Filter supervisor events"
              />
            </div>
            <label className="flex min-w-56 items-baseline gap-2 border-b border-rule pb-1 text-label uppercase tracking-wider text-fg-muted">
              <span>Type</span>
              <input
                type="text"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                placeholder="session.crashed"
                aria-label="Event type filter"
                className="min-w-0 flex-1 bg-transparent border-0 px-0 py-0.5 text-body normal-case tracking-normal text-fg placeholder:text-fg-faint focus:outline-none focus:ring-0"
              />
            </label>
          </div>
          <Table
            columns={eventColumns}
            rows={filteredEvents}
            rowKey={(r) => String(r.seq)}
            rowProps={eventRowProps}
            empty={
              eventFilter.length > 0 || eventType.length > 0
                ? 'No supervisor events match the current filter.'
                : 'No supervisor events in this window.'
            }
            initialSort={{ key: 'seq', dir: 'desc' }}
          />
        </section>
      )}
    </section>
  );
}

function deployTone(status: string): StatusTone {
  switch (status) {
    case 'ok':
      return 'ok';
    case 'failed':
      return 'stuck';
    case 'in-progress':
      return 'warn';
    default:
      return 'neutral';
  }
}

function buildSynopsis(
  commits: ReadonlyArray<GitCommit>,
  deploys: ReadonlyArray<DeployRecord>,
  now: number,
): string {
  const parts: string[] = [];
  const latestCommit = commits[0];
  if (latestCommit) {
    parts.push(`${commits.length} commits in view, latest ${formatRelative(latestCommit.date, now)}`);
  } else {
    parts.push('No commits in view');
  }
  const latestDeploy = deploys[0];
  if (latestDeploy) {
    parts.push(`last deploy ${formatRelative(latestDeploy.at, now)} (${latestDeploy.status})`);
  }
  return parts.join('; ') + '.';
}

function buildEventSynopsis(
  events: ReadonlyArray<SupervisorEventItem>,
  total: number,
  window: string,
  type: string,
): string {
  const attention = events.filter((event) => eventSeverityRank(event) === 0).length;
  const typePrefix = type.length > 0 ? `${type} ` : '';
  if (total === 0) return `No ${typePrefix}supervisor events in the last ${window}.`;
  if (attention > 0) {
    return `${events.length} ${typePrefix}supervisor events shown from the last ${window}, ${attention} attention.`;
  }
  return `${events.length} ${typePrefix}supervisor events shown from the last ${window}.`;
}

const DEFAULT_EVENT_WINDOW = '24h';

function parseActivityMode(value: string | null): ActivityMode {
  return value === 'events' ? 'events' : 'project';
}

function parseEventWindow(value: string | null): string {
  const normalized = normalizeQueryValue(value);
  return EVENT_WINDOWS.some((window) => window.value === normalized)
    ? normalized
    : DEFAULT_EVENT_WINDOW;
}

function normalizeQueryValue(value: string | null): string {
  return value?.trim() ?? '';
}

function filterEvents(
  events: ReadonlyArray<SupervisorEventItem>,
  filter: string,
): SupervisorEventItem[] {
  const needle = filter.trim().toLowerCase();
  if (needle.length === 0) return [...events];
  return events.filter((event) =>
    [
      event.type,
      event.actor,
      event.subject,
      event.message,
      supervisorEventDetail(event),
    ].some((value) => value?.toLowerCase().includes(needle)),
  );
}

function eventSignal(event: SupervisorEventItem): { tone: StatusTone; label: string } {
  switch (supervisorEventSignal(event)) {
    case 'attention':
      return { tone: 'stuck', label: 'attention' };
    case 'watch':
      return { tone: 'warn', label: 'watch' };
    case 'event':
      return { tone: 'neutral', label: 'event' };
  }
}

function eventSeverityRank(event: SupervisorEventItem): number {
  switch (supervisorEventSignal(event)) {
    case 'attention':
      return 0;
    case 'watch':
      return 1;
    case 'event':
      return 2;
  }
}
