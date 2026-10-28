import { GroupTreeNode } from '@f-tool/ui';
import { GroupEdge, GroupNode } from './models';
const MAX_DEPTH = 32;
export interface GroupGraphInput {
    groups: GroupNode[];
    edges: GroupEdge[];
}
export function parentsOf(graph: GroupGraphInput, groupId: number): GroupNode[] {
    const byId = new Map(graph.groups.map((g) => [g.id, g]));
    const ids = graph.edges
        .filter((e) => e.subjectKind === 'group' && Number(e.subjectId) === groupId)
        .map((e) => e.groupId);
    return [...new Set(ids)]
        .map((id) => byId.get(id))
        .filter((g): g is GroupNode => !!g)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
export function effectiveUsersOf(graph: GroupGraphInput, groupId: number): Set<string> {
    const users = new Set<string>();
    const seen = new Set<number>();
    const walk = (id: number, depth: number): void => {
        if (depth > MAX_DEPTH || seen.has(id))
            return;
        seen.add(id);
        for (const e of graph.edges) {
            if (e.groupId !== id)
                continue;
            if (e.subjectKind === 'user')
                users.add(e.subjectId);
            else
                walk(Number(e.subjectId), depth + 1);
        }
    };
    walk(groupId, 0);
    return users;
}
export function rootGroups(graph: GroupGraphInput): GroupNode[] {
    const children = new Set(graph.edges.filter((e) => e.subjectKind === 'group').map((e) => Number(e.subjectId)));
    return graph.groups.filter((g) => !children.has(g.id));
}
export function buildGroupTree(graph: GroupGraphInput, rootId?: number): GroupTreeNode[] {
    const byId = new Map(graph.groups.map((g) => [g.id, g]));
    const expanded = new Set<number>();
    const build = (g: GroupNode, depth: number): GroupTreeNode => {
        const node: GroupTreeNode = {
            kind: 'group',
            id: g.id,
            name: g.displayName,
            groupName: g.name,
            rank: g.rank ?? null,
            effectiveUsers: effectiveUsersOf(graph, g.id).size,
            repeated: expanded.has(g.id),
            children: [],
        };
        if (node.repeated || depth > MAX_DEPTH)
            return node;
        expanded.add(g.id);
        for (const e of graph.edges) {
            if (e.groupId !== g.id)
                continue;
            if (e.subjectKind === 'user') {
                node.children.push({ kind: 'user', id: e.subjectId, name: e.name, username: e.username });
            }
            else {
                const child = byId.get(Number(e.subjectId));
                if (child)
                    node.children.push(build(child, depth + 1));
            }
        }
        return node;
    };
    let roots: GroupNode[];
    if (rootId !== undefined) {
        const r = byId.get(rootId);
        roots = r ? [r] : [];
    }
    else {
        roots = rootGroups(graph);
        if (roots.length === 0)
            roots = graph.groups;
    }
    return roots.map((g) => build(g, 0));
}
export interface GroupExportNode {
    kind: 'group' | 'user';
    id: string;
    name: string;
    rank?: number;
    children?: GroupExportNode[];
}
export function buildExportTree(graph: GroupGraphInput, rootId?: number): GroupExportNode[] {
    const byId = new Map(graph.groups.map((g) => [g.id, g]));
    const build = (g: GroupNode, depth: number, trail: Set<number>): GroupExportNode => {
        const node: GroupExportNode = { kind: 'group', id: g.name, name: g.displayName, children: [] };
        if (g.rank != null)
            node.rank = g.rank;
        if (depth > MAX_DEPTH || trail.has(g.id))
            return node;
        const next = new Set(trail).add(g.id);
        for (const e of graph.edges) {
            if (e.groupId !== g.id)
                continue;
            if (e.subjectKind === 'user') {
                node.children!.push({ kind: 'user', id: e.username ?? e.subjectId, name: e.name });
            }
            else {
                const child = byId.get(Number(e.subjectId));
                if (child)
                    node.children!.push(build(child, depth + 1, next));
            }
        }
        return node;
    };
    let roots: GroupNode[];
    if (rootId !== undefined) {
        const r = byId.get(rootId);
        roots = r ? [r] : [];
    }
    else {
        roots = rootGroups(graph);
        if (roots.length === 0)
            roots = graph.groups;
    }
    return roots.map((g) => build(g, 0, new Set()));
}
export function exportPaths(tree: GroupExportNode[]): string[][] {
    return pathNodes(tree).map((p) => p.map((n) => n.id));
}
function pathNodes(tree: GroupExportNode[]): GroupExportNode[][] {
    const out: GroupExportNode[][] = [];
    const walk = (n: GroupExportNode, prefix: GroupExportNode[]): void => {
        const path = [...prefix, n];
        if (n.kind === 'user' || !n.children || n.children.length === 0) {
            out.push(path);
            return;
        }
        for (const c of n.children)
            walk(c, path);
    };
    for (const r of tree)
        walk(r, []);
    return out;
}
export function exportRankRows(tree: GroupExportNode[]): string[][] {
    const paths = pathNodes(tree);
    let max = -1;
    for (const p of paths)
        for (const n of p)
            if (n.kind === 'group' && n.rank != null)
                max = Math.max(max, n.rank);
    if (max < 0)
        return [];
    const header = [...Array.from({ length: max + 1 }, (_, i) => `rank${i}`), 'rest', 'user'];
    const rows = paths.map((p) => {
        const cols: string[] = Array.from({ length: max + 1 }, () => '');
        const rest: string[] = [];
        let user = '';
        let last = -1;
        let broken = false;
        for (const n of p) {
            if (n.kind === 'user') {
                user = n.id;
            }
            else if (!broken && n.rank != null && n.rank > last) {
                cols[n.rank] = n.id;
                last = n.rank;
            }
            else {
                broken = true;
                rest.push(n.id);
            }
        }
        return [...cols, rest.join('>'), user];
    });
    return [header, ...rows];
}
