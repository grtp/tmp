import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';
export type GroupTreeNode = {
    kind: 'group';
    id: number;
    name: string;
    groupName: string;
    rank: number | null;
    effectiveUsers: number;
    repeated: boolean;
    children: GroupTreeNode[];
} | {
    kind: 'user';
    id: string;
    name: string;
    username?: string;
};
export interface GroupTreeRoot {
    id: number;
    name: string;
    groupName: string;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-group-tree',
    imports: [MatIcon, NgTemplateOutlet, TranslocoPipe],
    templateUrl: './group-tree.html',
    styleUrl: './group-tree.css',
})
export class GroupTree {
    readonly nodes = input<GroupTreeNode[]>([]);
    readonly roots = input<GroupTreeRoot[]>([]);
    readonly rootId = input<number | null>(null);
    readonly loading = input(false);
    readonly rootChanged = output<number | null>();
    readonly editClicked = output<number>();
    readonly userClicked = output<string>();
    readonly exportClicked = output<void>();
    protected readonly collapsed = signal<ReadonlySet<string>>(new Set());
    constructor() {
        effect(() => {
            void this.nodes();
            this.collapsed.set(new Set());
        });
    }
    protected readonly isEmpty = computed(() => this.nodes().length === 0);
    protected key(path: string, node: GroupTreeNode): string {
        return `${path}/${node.kind}:${node.id}`;
    }
    protected isCollapsed(k: string): boolean {
        return this.collapsed().has(k);
    }
    protected toggle(k: string): void {
        this.collapsed.update((s) => {
            const next = new Set(s);
            if (next.has(k))
                next.delete(k);
            else
                next.add(k);
            return next;
        });
    }
    protected expandAll(): void {
        this.collapsed.set(new Set());
    }
    protected collapseAll(): void {
        const keys = new Set<string>();
        const walk = (nodes: GroupTreeNode[], path: string): void => {
            for (const n of nodes) {
                if (n.kind !== 'group')
                    continue;
                const k = this.key(path, n);
                if (n.children.length > 0)
                    keys.add(k);
                walk(n.children, k);
            }
        };
        walk(this.nodes(), '');
        this.collapsed.set(keys);
    }
    protected onRootChange(value: string): void {
        this.rootChanged.emit(value === '' ? null : Number(value));
    }
}
