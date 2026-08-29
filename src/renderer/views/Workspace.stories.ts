import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { useTabs } from '@renderer/stores/tabs';
import { connected, withEntities, withJobs, withProvider } from '../../../.storybook/seed';
import Workspace from './Workspace.vue';

/**
 * The whole window once a connection is open.
 *
 * Four regions: an icon rail, a resizable sidebar, the tabbed workspace, and a
 * status bar the active tab contributes to. One bar spans the window and the
 * OS's window controls sit on it — which is what makes them safe, because
 * nothing below may be positioned back over it.
 */
const frame = `<div style="width:72rem; height:44rem; display:flex;"><Workspace /></div>`;

const meta = {
  title: 'Pages/Workspace',
  component: Workspace,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Workspace>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing open, which is what a fresh connection looks like. */
export const NothingOpen: Story = {
  render: () => ({
    components: { Workspace },
    setup: () => {
      withEntities({ expand: ['music'] });
      return {};
    },
    template: frame,
  }),
};

export const WithATable: Story = {
  render: () => ({
    components: { Workspace },
    setup: () => {
      withEntities({ expand: ['music'] });
      useTabs().openEntity('table', { name: 'album', schema: 'music' });
      return {};
    },
    template: frame,
  }),
};

export const WithAQuery: Story = {
  render: () => ({
    components: { Workspace },
    setup: () => {
      withEntities({ expand: ['music'] });
      useTabs().openQuery('select id, title from music.album limit 50;');
      return {};
    },
    template: frame,
  }),
};

/** The assistant, in a tab beside everything else. */
export const WithAChat: Story = {
  render: () => ({
    components: { Workspace },
    setup: () => {
      withEntities({ expand: ['music'] });
      void withProvider();
      useTabs().openChat();
      return {};
    },
    template: frame,
  }),
};

/** Several tabs at once — the state the strip's marker has to survive. */
export const Crowded: Story = {
  render: () => ({
    components: { Workspace },
    setup: () => {
      withEntities({ expand: ['music'] });
      withJobs();
      const tabs = useTabs();
      tabs.openEntity('table', { name: 'album', schema: 'music' });
      tabs.openEntity('table', { name: 'track', schema: 'music' });
      tabs.openQuery('select 1');
      tabs.openErd({ kind: 'schema', name: 'music' });
      tabs.openChat();
      return {};
    },
    template: frame,
  }),
};

/** A connection with nothing in it, which is a real thing that happens. */
export const EmptyDatabase: Story = {
  render: () => ({
    components: { Workspace },
    setup: () => {
      connected();
      return {};
    },
    template: frame,
  }),
};
