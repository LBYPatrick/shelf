import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { SAVED_CONNECTIONS } from '../../../../.storybook/fixtures/database';
import ConnectionForm from './ConnectionForm.vue';

/**
 * The fields a connection needs, which differ per engine.
 *
 * The password field is the one deliberate exception to "the renderer never
 * sees a secret": a form that will not show you what it already holds forces
 * you to retype a password to change a port.
 */
const meta = {
  title: 'Connection/ConnectionForm',
  component: ConnectionForm,
  args: { editing: null, keyringAvailable: true, testing: false },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { ConnectionForm },
    setup: () => ({ args }),
    template: `<div style="width:34rem; padding:1rem;"><ConnectionForm v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof ConnectionForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A new connection, with nothing chosen yet. */
export const New: Story = {};

export const EditingPostgres: Story = { args: { editing: SAVED_CONNECTIONS[0]! } };

/** A file-backed engine: no host, no port, a path instead. */
export const EditingFileBacked: Story = { args: { editing: SAVED_CONNECTIONS[2]! } };

/** Testing, which disables the button that started it. */
export const Testing: Story = { args: { editing: SAVED_CONNECTIONS[0]!, testing: true } };

/**
 * No keyring. Storing a password in plaintext would be worse than not
 * remembering it, so the app says so and prompts each time instead.
 */
export const WithoutKeyring: Story = {
  args: { editing: SAVED_CONNECTIONS[0]!, keyringAvailable: false },
};

/** Fields recovered from a pasted connection URL. */
export const FromAPastedUrl: Story = {
  args: {
    seed: {
      engine: 'postgres',
      config: {
        engine: 'postgres',
        host: 'db.example.com',
        port: 5432,
        username: 'reader',
        database: 'analytics',
      },
      suggestedName: 'analytics on db.example.com',
    },
  },
};
