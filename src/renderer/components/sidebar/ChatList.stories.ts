import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { useAssistant } from '@renderer/stores/assistant';
import { withChats } from '../../../../.storybook/seed';
import ChatList from './ChatList.vue';

/**
 * Conversations, as cards.
 *
 * The same card a job is, because they are the same kind of object: a thing
 * that ran, has a name you can change, and can be thrown away. What to look at
 * here is the *evenness* — every row the same height whether its name takes one
 * line or two, so the column can be swept rather than read.
 *
 * The search field is not in this component. It lives in the panel's header
 * row, where every other panel's field is; `Pages/Workspace` shows the two
 * together.
 */
const meta = {
  title: 'Sidebar/ChatList',
  component: ChatList,
  render: () => ({
    components: { ChatList },
    setup: () => {
      withChats();
      return {};
    },
    template: `<div style="width:17rem; height:22rem;"><ChatList /></div>`,
  }),
} satisfies Meta<typeof ChatList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Several: Story = {};

/** Nothing yet. The empty state says what would put something here. */
export const Empty: Story = {
  render: () => ({
    components: { ChatList },
    setup: () => {
      useAssistant().chats = [];
      return {};
    },
    template: `<div style="width:17rem; height:22rem;"><ChatList /></div>`,
  }),
};

/**
 * Titles long enough to wrap, which most real ones are — a chat is named after
 * the question that started it. Two lines, then an ellipsis, and the card is
 * the same height as the ones above it either way.
 */
export const LongTitles: Story = {
  render: () => ({
    components: { ChatList },
    setup: () => {
      withChats();
      const assistant = useAssistant();
      assistant.chats = assistant.chats.map((chat) => ({
        ...chat,
        title: `${chat.title} broken down by region and channel for the last quarter`,
      }));
      return {};
    },
    template: `<div style="width:17rem; height:22rem;"><ChatList /></div>`,
  }),
};

/**
 * Searching, from the field in the header this component does not draw.
 *
 * Worth a story of its own because the term lives in the store rather than in
 * the list, and a list that quietly ignores it would look exactly like a list
 * that matched everything.
 */
export const Searching: Story = {
  render: () => ({
    components: { ChatList },
    setup: () => {
      withChats();
      useAssistant().filter = { text: 'rows', criteria: [] };
      return {};
    },
    template: `<div style="width:17rem; height:22rem;"><ChatList /></div>`,
  }),
};

/** Nothing matched. The list says so rather than showing an empty column. */
export const NoMatch: Story = {
  render: () => ({
    components: { ChatList },
    setup: () => {
      withChats();
      useAssistant().filter = { text: 'zzzz', criteria: [] };
      return {};
    },
    template: `<div style="width:17rem; height:22rem;"><ChatList /></div>`,
  }),
};
