import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { AI_DRIVERS } from '@shared/aiDrivers';
import ProviderMark from './ProviderMark.vue';

/**
 * Whose assistant this is.
 *
 * Every provider in the list wore the same sparkle, which said "assistant" in a
 * list of nothing but assistants. The one thing a reader wants to know there is
 * which company is about to be sent their question.
 *
 * They are filled marks on a 24-unit box rather than stroked glyphs on the
 * app's 16-unit grid, because a brand mark's geometry belongs to somebody else
 * and redrawing it on our grid would make it a different mark. They inherit
 * `currentColor`, so the row they sit in decides their colour and neither
 * theme needs a value of its own.
 */
const meta = {
  title: 'Assistant/ProviderMark',
  component: ProviderMark,
  args: { driver: 'anthropic', size: 16 },
} satisfies Meta<typeof ProviderMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Anthropic: Story = {};

/**
 * All of them at the size the provider list draws them, which is the size the
 * question "is this recognisable?" has to be answered at.
 */
export const EveryDriver: Story = {
  render: () => ({
    components: { ProviderMark },
    setup: () => ({ drivers: AI_DRIVERS }),
    template: `
      <ul style="display:grid;gap:0.75rem;padding:1rem;list-style:none;">
        <li
          v-for="driver in drivers"
          :key="driver.kind"
          style="display:flex;align-items:center;gap:0.5rem;"
        >
          <ProviderMark :driver="driver.kind" :size="14" />
          <span>{{ driver.label }}</span>
        </li>
      </ul>
    `,
  }),
};

/**
 * The last row is deliberately generic: one driver stands for Ollama, LM
 * Studio, vLLM and OpenRouter, and any one company's mark there would name the
 * wrong company most of the time.
 */
export const Generic: Story = { args: { driver: 'openaiCompatible' } };
