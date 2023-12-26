import {
    CompositeDisposable,
    Disposable,
    IDisposable,
    MutableDisposable,
} from '../../../lifecycle';
import { Emitter, Event } from '../../../events';
import { trackFocus } from '../../../dom';
import { IDockviewPanel } from '../../dockviewPanel';
import { DockviewComponent } from '../../dockviewComponent';
import { DragAndDropObserver } from '../../../dnd/dnd';
import { Droptarget } from '../../../dnd/droptarget';
import { DockviewGroupPanelModel } from '../../dockviewGroupPanelModel';
import { getPanelData } from '../../../dnd/dataTransfer';
import { DockviewDropTargets } from '../../types';

export interface IContentContainer extends IDisposable {
    readonly dropTarget: Droptarget;
    onDidFocus: Event<void>;
    onDidBlur: Event<void>;
    element: HTMLElement;
    layout(width: number, height: number): void;
    openPanel: (panel: IDockviewPanel) => void;
    closePanel: () => void;
    show(): void;
    hide(): void;
    renderPanel(panel: IDockviewPanel): void;
}

export class ContentContainer
    extends CompositeDisposable
    implements IContentContainer
{
    private _element: HTMLElement;
    private panel: IDockviewPanel | undefined;
    private disposable = new MutableDisposable();

    private readonly _onDidFocus = new Emitter<void>();
    readonly onDidFocus: Event<void> = this._onDidFocus.event;

    private readonly _onDidBlur = new Emitter<void>();
    readonly onDidBlur: Event<void> = this._onDidBlur.event;

    get element(): HTMLElement {
        return this._element;
    }

    readonly dropTarget: Droptarget;

    constructor(
        private readonly accessor: DockviewComponent,
        private readonly group: DockviewGroupPanelModel
    ) {
        super();
        this._element = document.createElement('div');
        this._element.className = 'content-container';
        this._element.tabIndex = -1;

        this.addDisposables(this._onDidFocus, this._onDidBlur);

        // for hosted containers
        // 1) register a drop target on the host
        // 2) register window dragStart events to disable pointer events
        // 3) register dragEnd events
        // 4) register mouseMove events (if no buttons are present we take this as a dragEnd event)

        this.dropTarget = new Droptarget(this.element, {
            acceptedTargetZones: ['top', 'bottom', 'left', 'right', 'center'],
            canDisplayOverlay: (event, position) => {
                if (
                    this.group.locked === 'no-drop-target' ||
                    (this.group.locked && position === 'center')
                ) {
                    return false;
                }

                const data = getPanelData();

                if (
                    !data &&
                    event.shiftKey &&
                    this.group.location !== 'floating'
                ) {
                    return false;
                }

                if (data && data.viewId === this.accessor.id) {
                    if (data.groupId === this.group.id) {
                        if (position === 'center') {
                            // don't allow to drop on self for center position
                            return false;
                        }
                        if (data.panelId === null) {
                            // don't allow group move to drop anywhere on self
                            return false;
                        }
                    }

                    const groupHasOnePanelAndIsActiveDragElement =
                        this.group.panels.length === 1 &&
                        data.groupId === this.group.id;

                    return !groupHasOnePanelAndIsActiveDragElement;
                }

                return this.group.canDisplayOverlay(
                    event,
                    position,
                    DockviewDropTargets.Panel
                );
            },
        });

        this.addDisposables(this.dropTarget);
    }

    show(): void {
        this.element.style.display = '';
    }

    hide(): void {
        this.element.style.display = 'none';
    }

    renderPanel(panel: IDockviewPanel): void {
        const isActive = panel === this.group.activePanel;

        let container: HTMLElement;

        switch (panel.api.renderer) {
            case 'destructive':
                this.accessor.greadyRenderContainer.remove(panel);
                if (isActive) {
                    if (this.panel) {
                        this._element.appendChild(
                            this.panel.view.content.element
                        );
                    }
                }
                container = this._element;
                break;
            case 'gready':
                if (
                    panel.view.content.element.parentElement === this._element
                ) {
                    this._element.removeChild(panel.view.content.element);
                }
                container =
                    this.accessor.greadyRenderContainer.setReferenceContentContainer(
                        panel,
                        this
                    );
                break;
        }

        if (isActive) {
            const _onDidFocus = panel.view.content.onDidFocus;
            const _onDidBlur = panel.view.content.onDidBlur;

            const focusTracker = trackFocus(container);
            const disposable = new CompositeDisposable();

            disposable.addDisposables(
                focusTracker,
                focusTracker.onDidFocus(() => this._onDidFocus.fire()),
                focusTracker.onDidBlur(() => this._onDidBlur.fire())
            );

            if (_onDidFocus) {
                disposable.addDisposables(
                    _onDidFocus(() => this._onDidFocus.fire())
                );
            }
            if (_onDidBlur) {
                disposable.addDisposables(
                    _onDidBlur(() => this._onDidBlur.fire())
                );
            }

            this.disposable.value = disposable;
        }
    }

    public openPanel(panel: IDockviewPanel): void {
        if (this.panel === panel) {
            return;
        }

        const renderer = panel.api.renderer;

        if (
            this.panel &&
            this.panel.view.content.element.parentElement === this._element
        ) {
            /**
             * If the currently attached panel is mounted directly to the content then remove it
             */
            this._element.removeChild(this.panel.view.content.element);
        }

        this.panel = panel;

        let container: HTMLElement;

        switch (renderer) {
            case 'gready':
                container =
                    this.accessor.greadyRenderContainer.setReferenceContentContainer(
                        panel,
                        this
                    );
                break;
            case 'destructive':
                this._element.appendChild(this.panel.view.content.element);
                container = this._element;
                break;
        }

        const _onDidFocus = this.panel.view.content.onDidFocus;
        const _onDidBlur = this.panel.view.content.onDidBlur;

        const disposable = new CompositeDisposable();
        const focusTracker = trackFocus(container);

        disposable.addDisposables(
            focusTracker,
            focusTracker.onDidFocus(() => this._onDidFocus.fire()),
            focusTracker.onDidBlur(() => this._onDidBlur.fire())
        );

        if (_onDidFocus) {
            disposable.addDisposables(
                _onDidFocus(() => this._onDidFocus.fire())
            );
        }
        if (_onDidBlur) {
            disposable.addDisposables(_onDidBlur(() => this._onDidBlur.fire()));
        }

        this.disposable.value = disposable;
    }

    public layout(_width: number, _height: number): void {
        // noop
    }

    public closePanel(): void {
        if (this.panel) {
            if (this.accessor.options.defaultRenderer === 'destructive') {
                this._element.removeChild(this.panel.view.content.element);
            }
            this.panel = undefined;
        }
    }

    public dispose(): void {
        this.disposable.dispose();
        super.dispose();
    }
}
