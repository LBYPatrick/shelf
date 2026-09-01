import type { Meta, StoryObj } from '@storybook/vue3-vite';
import type { UpdateDelivery, UpdateState } from '@shared/updates';
import { useUpdates } from '@renderer/stores/updates';
import UpdateSheet from './UpdateSheet.vue';

/**
 * Every state the update flow can be in.
 *
 * This is the reason the storybook exists. Four of these six are unreachable in
 * a running app without a release actually being cut — you cannot see the
 * download panel without a hundred megabytes arriving, and you cannot see the
 * failure without unplugging the network at the right moment — so this is the
 * only place the panels can be compared to each other and to the sheet they all
 * live in.
 *
 * The pair at the end is the point of the feature: the same release, on an
 * install that can replace itself and on one that cannot. Everything above the
 * footer is identical and only the verb changes.
 */
const RELEASE = {
  version: '1.4.0',
  url: 'https://github.com/LBYPatrick/shelf/releases/tag/v1.4.0',
  publishedAt: '2026-09-01T09:00:00Z',
  /*
   * Deliberately the shape a real release body takes, table included.
   *
   * 1.4.0's own notes carried one, and the panel was showing it as `<table>`
   * `<thead>` `<tr>` in plain text — the feed's notes are GitHub's rendered
   * HTML, and the panel renders markdown. Nothing here would have caught it,
   * because the fixture was four bullets. It has a table now so the widest
   * thing release notes actually contain is on screen in a 34rem popup.
   */
  notes: [
    '### Added',
    '',
    '- The structure view now draws foreign keys between schemas.',
    '- `EXPLAIN` output can be opened as a diagram.',
    '',
    '| Install | What happens |',
    '| --- | --- |',
    '| macOS, the Windows installer, the Linux AppImage | Downloaded and installed |',
    '| `.deb`, `.rpm`, the portable build | The release page opens |',
    '',
    '### Fixed',
    '',
    '- A tab dragged one width no longer moves two places.',
    '- The stored-data sheet no longer offers to clear the keychain.',
  ].join('\n'),
};

/**
 * Seeded twice, and the second time is not belt and braces.
 *
 * The store asks the bridge for the real state as it is created, and the mock
 * answers with deliberate latency — so a story that wrote the state once had it
 * overwritten a moment later by an app that is up to date, and every panel here
 * drew the idle state. The first write is what the first paint shows; the
 * second is what survives the answer.
 */
function seed(patch: Partial<UpdateState>, delivery: UpdateDelivery = 'in-app'): void {
  const updates = useUpdates();
  const write = () => {
    updates.state = { phase: 'idle', current: '1.3.1', delivery, ...patch };
    updates.open = true;
  };

  write();
  void updates.ready.then(write);
}

const meta = {
  title: 'Settings/UpdateSheet',
  component: UpdateSheet,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof UpdateSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

const story = (patch: Partial<UpdateState>, delivery?: UpdateDelivery): Story => ({
  render: () => ({
    components: { UpdateSheet },
    setup: () => {
      seed(patch, delivery);
      return {};
    },
    template: `<UpdateSheet />`,
  }),
});

export const Checking = story({ phase: 'checking' });

export const UpToDate = story({ phase: 'current' });

export const Available = story({ phase: 'available', release: RELEASE });

export const Downloading = story({
  phase: 'downloading',
  release: RELEASE,
  progress: {
    transferred: 41_000_000,
    total: 118_000_000,
    percent: 34.7,
    bytesPerSecond: 5_200_000,
  },
});

export const ReadyToInstall = story({ phase: 'ready', release: RELEASE });

export const Failed = story({
  phase: 'error',
  message: 'GitHub answered 403 rate limit exceeded',
});

/**
 * The same release on a .deb, a portable .exe, or a build being developed.
 *
 * The panel is the panel; the footer offers the page, and the sentence above it
 * says why. Nobody is shown a Restart that could not have worked.
 */
export const DownloadPageOnly = story(
  { phase: 'available', release: RELEASE },
  'download-page'
);
