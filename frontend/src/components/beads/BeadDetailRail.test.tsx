import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  EntityLinkView,
  GcSession,
} from 'gas-city-dashboard-shared';
import { NowProvider } from '../../contexts/NowContext';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { BeadDetailRail } from './BeadDetailRail';

// useBeadDetail and useEntityLinks both call network-backed helpers; mock them
// so the rail renders without a backend. fetchSupervisorBead is never hit when
// initialBead carries a description (the freshness signal), but entityLinks
// always fires.
vi.mock('../../api/client', () => ({
  api: {
    entityLinks: vi.fn(
      (ref: string): Promise<EntityLinkView> =>
        Promise.resolve({
          focus: { key: `bead:c:${ref}`, type: 'bead', ref },
          nodes: [],
          edges: [],
          stats: [],
          partial: false,
          generatedAt: '2026-05-31T00:00:00Z',
          asOf: '2026-05-31T00:00:00Z',
        }),
    ),
  },
  ApiClientError: class extends Error {},
}));

const mockFetchSupervisorBead = vi.hoisted(() => vi.fn());

vi.mock('../../supervisor/beadReads', () => ({
  fetchSupervisorBead: mockFetchSupervisorBead,
}));

afterEach(() => cleanup());

function bead(extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return {
    id: 'b1',
    title: 'judge live smoke',
    status: 'in_progress',
    issue_type: 'task',
    created_at: '2026-05-01T00:00:00Z',
    description: 'do the thing',
    ...extra,
  };
}

function session(extra: Partial<GcSession> = {}): GcSession {
  return {
    id: 'gc-abc',
    template: 't',
    session_name: 'worker__gasworks',
    title: 'worker',
    state: 'active',
    created_at: '2026-05-01T00:00:00Z',
    attached: false,
    running: true,
    provider: 'claude',
    ...extra,
  };
}

describe('BeadDetailRail', () => {
  function renderRail(ui: ReactElement) {
    return render(<NowProvider intervalMs={1_000_000}>{ui}</NowProvider>);
  }

  it('prompts to select a bead when none is chosen', () => {
    renderRail(
      <BeadDetailRail
        beadId={null}
        initialBead={null}
        sessions={[]}
        onOpenBead={vi.fn()}
      />,
    );
    expect(screen.getByText(/select a bead/i)).toBeTruthy();
  });

  it('offers a live-run click-through when the assignee resolves to a streamable session', async () => {
    const b = bead({ assignee: 'gasworks' });
    renderRail(
      <BeadDetailRail
        beadId="b1"
        initialBead={b}
        sessions={[session({ pool: 'gasworks' })]}
        onOpenBead={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/view live run/i)).toBeTruthy(),
    );
  });

  it('fetches bead detail from the supervisor API when the selected bead is outside the cached window', async () => {
    mockFetchSupervisorBead.mockResolvedValue(bead({
      id: 'td-outside-window',
      title: 'fetched from supervisor',
      description: 'loaded directly',
    }));

    renderRail(
      <BeadDetailRail
        beadId="td-outside-window"
        initialBead={null}
        sessions={[]}
        onOpenBead={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(mockFetchSupervisorBead).toHaveBeenCalledWith('td-outside-window');
    });
    expect(await screen.findByText('fetched from supervisor')).toBeTruthy();
  });

  it('omits the live-run affordance when no session matches the assignee', async () => {
    const b = bead({ assignee: 'nobody' });
    renderRail(
      <BeadDetailRail
        beadId="b1"
        initialBead={b}
        sessions={[session({ pool: 'gasworks' })]}
        onOpenBead={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('judge live smoke')).toBeTruthy());
    expect(screen.queryByText(/view live run/i)).toBeNull();
  });

  it('omits the live-run affordance when the matched session is not streamable', async () => {
    const b = bead({ assignee: 'gasworks' });
    renderRail(
      <BeadDetailRail
        beadId="b1"
        initialBead={b}
        sessions={[session({ pool: 'gasworks', state: 'exited', running: false })]}
        onOpenBead={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('judge live smoke')).toBeTruthy());
    expect(screen.queryByText(/view live run/i)).toBeNull();
  });
});
