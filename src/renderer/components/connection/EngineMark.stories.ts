import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ENGINES } from '@shared/engines';
import EngineMark from './EngineMark.vue';

/**
 * Every engine's mark, on every engine's tile.
 *
 * The one view worth having of this: nine marks side by side is how you find
 * out that two of them read the same at 20px, which no single story can show.
 * DynamoDB is the odd one out and is supposed to be — Amazon's service marks
 * are not in `simple-icons`, so it keeps the two letters.
 */
const meta = {
  title: 'Connection/EngineMark',
  component: EngineMark,
  args: { engine: 'postgres' as const, size: 16 },
} satisfies Meta<typeof EngineMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const One: Story = {};

/** All of them, at the size the start screen draws them. */
export const Every: Story = {
  render: () => ({
    components: { EngineMark },
    setup: () => ({ engines: ENGINES }),
    template: `
      <div style="display:flex; flex-wrap:wrap; gap:1rem;">
        <div
          v-for="engine in engines"
          :key="engine.id"
          style="display:flex; flex-direction:column; align-items:center; gap:0.35rem; width:5rem;"
        >
          <span
            :style="{
              '--engine-hue': engine.hue,
              display: 'grid',
              placeItems: 'center',
              width: '2rem',
              height: '2rem',
              borderRadius: '0.5rem',
              color: 'oklch(99% 0 0)',
              fontSize: '0.625rem',
              fontWeight: 650,
              background:
                'linear-gradient(145deg, oklch(64% 0.16 var(--engine-hue)), oklch(52% 0.17 var(--engine-hue)))',
            }"
          >
            <EngineMark :engine="engine.id" :size="18" />
          </span>
          <span style="font-size:0.6875rem; opacity:0.7;">{{ engine.name }}</span>
        </div>
      </div>
    `,
  }),
};
