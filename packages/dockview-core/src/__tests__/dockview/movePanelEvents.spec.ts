import { DockviewComponent } from '../../dockview/dockviewComponent';
import { DockviewGroupPanel } from '../../dockview/dockviewGroupPanel';
import { DockviewPanel } from '../../dockview/dockviewPanel';
import { IContentRenderer } from '../../dockview/types';
import { Orientation } from '../../splitview/splitview';
import { setupMockWindow } from '../__mocks__/mockWindow';

class TestPanel implements IContentRenderer {
    element = document.createElement('div');
    init(): void {
        // noop
    }
    layout(): void {
        // noop
    }
    dispose(): void {
        // noop
    }
}

type Recorded = {
    panel: string;
    from: string;
    to: string;
    location: string;
};

/**
 * `onDidMovePanel` is the single event a consumer can use to mirror panel
 * relocations into their own model. It must fire for every way a panel changes
 * group - including being extracted into a new floating or popout window - and
 * must report both ends of the move.
 */
describe('onDidMovePanel', () => {
    let container: HTMLElement;
    let dockview: DockviewComponent;
    let recorded: Recorded[];

    beforeEach(() => {
        window.open = () => setupMockWindow();
        container = document.createElement('div');
        dockview = new DockviewComponent(container, {
            createComponent: () => new TestPanel(),
        });
        dockview.layout(1000, 1000);
    });

    afterEach(() => dockview.dispose());

    function record(): void {
        recorded = [];
        dockview.onDidMovePanel((event) =>
            recorded.push({
                panel: event.panel.id,
                from: event.from.id,
                to: event.to.id,
                location: event.panel.api.location.type,
            })
        );
    }

    test('fires when a panel is dropped into a new group in the grid', () => {
        const panel1 = dockview.addPanel({
            id: 'panel1',
            component: 'default',
        });
        const panel2 = dockview.addPanel({
            id: 'panel2',
            component: 'default',
        });
        const originalGroup = panel1.group;

        record();

        dockview.moveGroupOrPanel({
            from: { groupId: panel2.group.id, panelId: 'panel2' },
            to: { group: panel1.group, position: 'right' },
        });

        expect(recorded).toHaveLength(1);
        expect(recorded[0].panel).toBe('panel2');
        expect(recorded[0].from).toBe(originalGroup.id);
        expect(recorded[0].to).toBe(panel2.group.id);
        expect(recorded[0].to).not.toBe(recorded[0].from);
        expect(recorded[0].location).toBe('grid');
    });

    test('fires when a panel is extracted into a new floating group', () => {
        dockview.addPanel({ id: 'panel1', component: 'default' });
        const panel2 = dockview.addPanel({
            id: 'panel2',
            component: 'default',
        });
        const originalGroup = panel2.group;

        record();

        dockview.addFloatingGroup(panel2 as DockviewPanel, {
            inDragMode: true,
        });

        expect(recorded).toHaveLength(1);
        expect(recorded[0].panel).toBe('panel2');
        expect(recorded[0].from).toBe(originalGroup.id);
        expect(recorded[0].to).toBe(panel2.group.id);
        expect(recorded[0].to).not.toBe(recorded[0].from);
        // the event must not arrive mid-transition: by the time it fires the
        // panel already reports its final location
        expect(recorded[0].location).toBe('floating');
    });

    test('fires when a panel is dropped into an existing floating group', () => {
        dockview.addPanel({ id: 'panel1', component: 'default' });
        const panel2 = dockview.addPanel({
            id: 'panel2',
            component: 'default',
        });
        const panel3 = dockview.addPanel({
            id: 'panel3',
            component: 'default',
        });
        const originalGroup = panel2.group;

        dockview.addFloatingGroup(panel3 as DockviewPanel);
        const floatingGroup = panel3.group;

        record();

        dockview.moveGroupOrPanel({
            from: { groupId: panel2.group.id, panelId: 'panel2' },
            to: { group: floatingGroup, position: 'center' },
        });

        expect(recorded).toEqual([
            {
                panel: 'panel2',
                from: originalGroup.id,
                to: floatingGroup.id,
                location: 'floating',
            },
        ]);
    });

    test('fires when a floating panel is docked back into the grid', () => {
        const panel1 = dockview.addPanel({
            id: 'panel1',
            component: 'default',
        });
        const panel2 = dockview.addPanel({
            id: 'panel2',
            component: 'default',
        });

        dockview.addFloatingGroup(panel2 as DockviewPanel);
        const floatingGroup = panel2.group;

        record();

        dockview.moveGroupOrPanel({
            from: { groupId: floatingGroup.id, panelId: 'panel2' },
            to: { group: panel1.group, position: 'center' },
        });

        expect(recorded).toEqual([
            {
                panel: 'panel2',
                from: floatingGroup.id,
                to: panel1.group.id,
                location: 'grid',
            },
        ]);
    });

    test('fires when a panel is extracted into a new popout group', async () => {
        dockview.addPanel({ id: 'panel1', component: 'default' });
        const panel2 = dockview.addPanel({
            id: 'panel2',
            component: 'default',
        });
        const originalGroup = panel2.group;

        record();

        await dockview.addPopoutGroup(panel2 as DockviewPanel);

        expect(recorded).toHaveLength(1);
        expect(recorded[0].panel).toBe('panel2');
        expect(recorded[0].from).toBe(originalGroup.id);
        expect(recorded[0].to).toBe(panel2.group.id);
        expect(recorded[0].to).not.toBe(recorded[0].from);
        expect(recorded[0].location).toBe('popout');
    });

    test('does not fire when the last panel of a group is popped out', async () => {
        const panel1 = dockview.addPanel({
            id: 'panel1',
            component: 'default',
        });

        record();

        // a single-panel group pops the whole group out; the panel keeps its
        // group so no panel-level move has occurred
        await dockview.addPopoutGroup(panel1 as DockviewPanel);

        expect(recorded).toEqual([]);
    });

    test('does not fire when floating groups are restored from JSON', () => {
        record();

        dockview.fromJSON({
            grid: {
                root: {
                    type: 'branch',
                    data: [
                        {
                            type: 'leaf',
                            data: {
                                views: ['panel1'],
                                id: 'group-1',
                                activeView: 'panel1',
                            },
                            size: 1000,
                        },
                    ],
                    size: 1000,
                },
                height: 1000,
                width: 1000,
                orientation: Orientation.HORIZONTAL,
            },
            panels: {
                panel1: {
                    id: 'panel1',
                    contentComponent: 'default',
                    title: 'panel1',
                },
                panel2: {
                    id: 'panel2',
                    contentComponent: 'default',
                    title: 'panel2',
                },
            },
            floatingGroups: [
                {
                    data: {
                        views: ['panel2'],
                        id: 'group-2',
                        activeView: 'panel2',
                    },
                    position: { left: 10, top: 10, width: 200, height: 200 },
                },
            ],
        });

        expect(recorded).toEqual([]);
    });

    test('does not fire when a floating panel is added via addPanel', () => {
        record();

        dockview.addPanel({
            id: 'panel1',
            component: 'default',
            floating: true,
        });

        expect(recorded).toEqual([]);
    });

    test('reports `to` equal to `from` when the group itself is relocated', () => {
        const panel1 = dockview.addPanel({
            id: 'panel1',
            component: 'default',
        });
        const panel2 = dockview.addPanel({
            id: 'panel2',
            component: 'default',
            position: { direction: 'right' },
        });

        const group1: DockviewGroupPanel = panel1.group;
        const group2: DockviewGroupPanel = panel2.group;

        record();

        dockview.moveGroup({
            from: { group: group2 },
            to: { group: group1, position: 'left' },
        });

        expect(recorded).toEqual([
            {
                panel: 'panel2',
                from: group2.id,
                to: group2.id,
                location: 'grid',
            },
        ]);
    });
});
