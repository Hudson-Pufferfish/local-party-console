import type { VoidComponent } from 'solid-js';

export const Standby: VoidComponent<{ copy: string }> = (props) => {
  return (
    <section class="standby">
      <h1>{props.copy}</h1>
    </section>
  );
};
