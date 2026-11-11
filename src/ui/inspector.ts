import { h } from './dom';

/** Right-hand panel; tools and selections put their content here. */
export class Inspector {
  readonly el = h('div', { class: 'panel inspector' });
  private owner: unknown = null;

  show(owner: unknown, content: HTMLElement): void {
    this.owner = owner;
    this.el.replaceChildren(content);
    this.el.classList.add('open');
  }
  /** Replace content only if `owner` still owns the panel. */
  update(owner: unknown, content: HTMLElement): void {
    if (this.owner === owner) this.el.replaceChildren(content);
  }
  hide(owner?: unknown): void {
    if (owner !== undefined && owner !== this.owner) return;
    this.owner = null;
    this.el.classList.remove('open');
    this.el.replaceChildren();
  }
  isOwner(owner: unknown): boolean {
    return this.owner === owner;
  }
}
