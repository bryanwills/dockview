import { isEventWithin } from './dom';
import { addDisposableListener } from './events';
import { CompositeDisposable, IDisposable } from './lifecycle';

/** Touch-primary input (coarse pointer, no fine pointer). On these devices a
 *  window resize is usually an on-screen-keyboard pop / orientation change /
 *  address-bar collapse, none of which mean "dismiss". */
function isCoarsePrimaryInput(win: Window): boolean {
    if (!win.matchMedia) {
        return false;
    }
    const coarse = win.matchMedia('(pointer: coarse)').matches;
    const fine = win.matchMedia('(pointer: fine)').matches;
    return coarse && !fine;
}

export interface DismissableLayerOptions {
    /** Window to listen on. Pass the popout window for popout-hosted layers.
     *  Defaults to the global `window`. */
    readonly window?: Window;
    /** Invoked when any enabled dismiss signal fires. */
    readonly onDismiss: () => void;
    /** A pointerdown landed *inside* the layer (not a dismissal). Use it to
     *  mark interaction (e.g. make a transient layer sticky). */
    readonly onInsidePointerDown?: (event: PointerEvent) => void;
    /** Whether a pointer event is inside the layer. Defaults to checking the
     *  event's composed path against {@link DismissableLayerOptions.elements}.
     *  Provide this for geometry-based hit testing (e.g. when the visible
     *  content is a sibling overlay stacked on top of the layer). */
    readonly isInside?: (event: PointerEvent) => boolean;
    /** Elements treated as "inside" by the default contains check. */
    readonly elements?: () => HTMLElement[];
    /** Dismiss on `Escape` (default `true`). */
    readonly escape?: boolean;
    /** Extra keys that also dismiss (e.g. `'Enter'`). */
    readonly keys?: readonly string[];
    /** Dismiss on a pointerdown outside the layer (default `true`). */
    readonly outsidePointerDown?: boolean;
    /** Ignore outside-pointerdowns for this many ms after opening. Covers the
     *  gesture that opened the layer (e.g. a touch long-press) dispatching a
     *  follow-up pointerdown just outside it. */
    readonly pointerDownGraceMs?: number;
    /** Dismiss on window resize, skipping touch-driven resizes (default
     *  `false`). */
    readonly resize?: boolean;
    /** Dismiss when focus moves to an element *outside* the layer (default
     *  `false`): the "slide back on focus loss" behaviour. */
    readonly focusOut?: boolean;
    /** Whether a newly-focused element is inside the layer (for
     *  {@link focusOut}). Receives the `focusin` target as the listener sees
     *  it, so focus inside a shadow root the listener is outside of arrives
     *  as that root's host. Defaults to checking the event's composed path
     *  against {@link elements}. Provide this for geometry-based testing
     *  when the content is a sibling overlay stacked on top of the layer. */
    readonly isFocusInside?: (focused: Element) => boolean;
    /** Listen in the capture phase (default `false`). Use capture when the
     *  layer must see the event before content handlers stop its propagation. */
    readonly capture?: boolean;
    /** Clock source for the grace window. Defaults to `Date.now`. */
    readonly now?: () => number;
}

/**
 * The shared dismissal lifecycle behind transient surfaces (popovers, menus,
 * peeks): while it lives it watches a configurable set of dismiss signals
 * (Escape / extra keys, outside-pointerdown with an optional grace window,
 * window resize, focus moving outside) and calls `onDismiss`. Inside/outside is
 * decided by an `isInside` predicate (geometry) or by checking the event's
 * composed path against `elements`. Dispose to detach every listener.
 *
 * It owns only the *signals*, not the surface element, its position, or any
 * hover/keep-open policy, so callers keep their own element lifecycle and
 * layer this underneath.
 */
export function createDismissableLayer(
    options: DismissableLayerOptions
): IDisposable {
    const win = options.window ?? window;
    const capture = options.capture ?? false;
    const escape = options.escape ?? true;
    const keys = options.keys ?? [];
    const outside = options.outsidePointerDown ?? true;
    const grace = options.pointerDownGraceMs ?? 0;
    const now = options.now ?? Date.now;
    const openedAt = now();

    const disposables = new CompositeDisposable();

    const isInside = (event: PointerEvent): boolean => {
        if (options.isInside) {
            return options.isInside(event);
        }
        return isEventWithin(event, options.elements?.() ?? []);
    };

    if (escape || keys.length > 0) {
        disposables.addDisposables(
            addDisposableListener(
                win,
                'keydown',
                (event) => {
                    if (
                        (escape && event.key === 'Escape') ||
                        keys.includes(event.key)
                    ) {
                        options.onDismiss();
                    }
                },
                capture
            )
        );
    }

    if (outside || options.onInsidePointerDown) {
        disposables.addDisposables(
            addDisposableListener(
                win,
                'pointerdown',
                (event) => {
                    if (isInside(event)) {
                        options.onInsidePointerDown?.(event);
                        return;
                    }
                    if (!outside || now() - openedAt < grace) {
                        return;
                    }
                    options.onDismiss();
                },
                capture
            )
        );
    }

    if (options.resize) {
        disposables.addDisposables(
            addDisposableListener(win, 'resize', () => {
                if (isCoarsePrimaryInput(win)) {
                    return;
                }
                options.onDismiss();
            })
        );
    }

    if (options.focusOut) {
        // `focusin` bubbles to the window; capture so it's seen regardless of
        // content handlers. A focus move *within* a shadow root never reaches
        // the window (the event is retargeted to the host and its path cut
        // there), so also listen on the shadow roots the layer lives in.
        let lastEvent: FocusEvent | undefined;
        const onFocusIn = (event: FocusEvent): void => {
            // Seen once by the shadow root and again by the window.
            if (event === lastEvent) {
                return;
            }
            lastEvent = event;
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }
            const inside = options.isFocusInside
                ? options.isFocusInside(target)
                : isEventWithin(event, options.elements?.() ?? []);
            if (!inside) {
                options.onDismiss();
            }
        };
        const targets = new Set<EventTarget>([win]);
        for (const el of options.elements?.() ?? []) {
            const root = el.getRootNode();
            if (
                root.nodeType === Node.DOCUMENT_FRAGMENT_NODE &&
                (root as ShadowRoot).host
            ) {
                targets.add(root);
            }
        }
        for (const target of targets) {
            disposables.addDisposables(
                addDisposableListener(
                    target as HTMLElement,
                    'focusin',
                    onFocusIn,
                    capture
                )
            );
        }
    }

    return disposables;
}
