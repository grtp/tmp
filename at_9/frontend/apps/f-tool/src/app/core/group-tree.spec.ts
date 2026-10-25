import { describe, expect, it } from 'vitest';
import { buildExportTree, buildGroupTree, effectiveUsersOf, exportPaths, exportRankRows, parentsOf, rootGroups, } from './group-tree';
const graph = {
    groups: [
        { id: 1, name: 'gr1', displayName: 'gr1' },
        { id: 2, name: 'gr2', displayName: 'gr2' },
        { id: 3, name: 'gr3', displayName: 'gr3' },
        { id: 4, name: 'gr4', displayName: 'gr4' },
        { id: 5, name: 'gr5', displayName: 'gr5' },
    ],
    edges: [
        { groupId: 1, subjectKind: 'user' as const, subjectId: 'u1', name: 'usr1', username: 'usr1' },
        { groupId: 1, subjectKind: 'user' as const, subjectId: 'u2', name: 'usr2', username: 'usr2' },
        { groupId: 1, subjectKind: 'group' as const, subjectId: '2', name: 'gr2' },
        { groupId: 2, subjectKind: 'group' as const, subjectId: '3', name: 'gr3' },
        { groupId: 3, subjectKind: 'group' as const, subjectId: '4', name: 'gr4' },
        { groupId: 4, subjectKind: 'user' as const, subjectId: 'u3', name: 'usr3', username: 'usr3' },
        { groupId: 4, subjectKind: 'user' as const, subjectId: 'u4', name: 'usr4', username: 'usr4' },
        { groupId: 4, subjectKind: 'user' as const, subjectId: 'u5', name: 'usr5', username: 'usr5' },
        { groupId: 5, subjectKind: 'group' as const, subjectId: '3', name: 'gr3' },
    ],
};
describe('group-tree', () => {
    it('ルートはどのグループにも所属していないグループ', () => {
        expect(rootGroups(graph).map((g) => g.name)).toEqual(['gr1', 'gr5']);
    });
    it('実効メンバーは下位を再帰的に辿った一意なユーザー', () => {
        expect(effectiveUsersOf(graph, 1).size).toBe(5);
        expect(effectiveUsersOf(graph, 3).size).toBe(3);
        expect(effectiveUsersOf(graph, 5).size).toBe(3);
    });
    it('所属先(親)を名前順で返す', () => {
        expect(parentsOf(graph, 3).map((g) => g.name)).toEqual(['gr2', 'gr5']);
        expect(parentsOf(graph, 1)).toEqual([]);
    });
    it('ツリー: 深い所属を展開し,2 回目の出現は既出の葉にする', () => {
        const tree = buildGroupTree(graph);
        expect(tree.map((n) => n.name)).toEqual(['gr1', 'gr5']);
        const gr1 = tree[0];
        expect(gr1.kind === 'group' && gr1.effectiveUsers).toBe(5);
        const names = (n: typeof gr1): string => n.kind === 'group' ? `${n.name}(${n.children.map(names).join(',')})` : n.name;
        expect(names(gr1)).toBe('gr1(usr1,usr2,gr2(gr3(gr4(usr3,usr4,usr5))))');
        const gr5 = tree[1];
        const gr3again = gr5.kind === 'group' ? gr5.children[0] : undefined;
        expect(gr3again?.kind === 'group' && gr3again.repeated).toBe(true);
        expect(gr3again?.kind === 'group' && gr3again.children.length).toBe(0);
    });
    it('ルート指定ではそのグループだけを根にする', () => {
        const tree = buildGroupTree(graph, 3);
        expect(tree).toHaveLength(1);
        expect(tree[0].name).toBe('gr3');
        expect(buildGroupTree(graph, 999)).toEqual([]);
    });
});
describe('export', () => {
    const g = {
        groups: [
            { id: 1, name: 'A', displayName: 'A 部' },
            { id: 2, name: 'B', displayName: 'B' },
            { id: 3, name: 'C', displayName: 'C' },
            { id: 4, name: 'D', displayName: 'D' },
        ],
        edges: [
            { groupId: 1, subjectKind: 'group' as const, subjectId: '2', name: 'B' },
            { groupId: 1, subjectKind: 'group' as const, subjectId: '3', name: 'C' },
            { groupId: 1, subjectKind: 'group' as const, subjectId: '4', name: 'D' },
            { groupId: 2, subjectKind: 'user' as const, subjectId: 'g1', name: 'User 1', username: 'u1' },
            { groupId: 3, subjectKind: 'user' as const, subjectId: 'g2', name: 'User 2', username: 'u2' },
            { groupId: 3, subjectKind: 'user' as const, subjectId: 'g3', name: 'User 3', username: 'u3' },
            { groupId: 3, subjectKind: 'user' as const, subjectId: 'g4', name: 'User 4', username: 'u4' },
        ],
    };
    it('JSON 用ツリーは管理用名を id,表示名を name に持つ', () => {
        const t = buildExportTree(g);
        expect(t).toHaveLength(1);
        expect(t[0]).toMatchObject({ kind: 'group', id: 'A', name: 'A 部' });
        expect(t[0].children?.map((c) => c.id)).toEqual(['B', 'C', 'D']);
        expect(t[0].children?.[0].children?.[0]).toEqual({ kind: 'user', id: 'u1', name: 'User 1' });
    });
    it('CSV 用の経路は末端がユーザー ID,子なしグループはそのグループで終わる', () => {
        expect(exportPaths(buildExportTree(g))).toEqual([
            ['A', 'B', 'u1'],
            ['A', 'C', 'u2'],
            ['A', 'C', 'u3'],
            ['A', 'C', 'u4'],
            ['A', 'D'],
        ]);
    });
    it('複数の親を持つグループは JSON/CSV とも親ごとに展開する', () => {
        const g2 = { ...g, edges: [...g.edges, { groupId: 4, subjectKind: 'group' as const, subjectId: '2', name: 'B' }] };
        const paths = exportPaths(buildExportTree(g2));
        expect(paths).toContainEqual(['A', 'D', 'B', 'u1']);
        expect(paths).toContainEqual(['A', 'B', 'u1']);
    });
    it('CSV(rank): ランク付きグループが無ければ空', () => {
        expect(exportRankRows(buildExportTree(g))).toEqual([]);
    });
    it('CSV(rank): ランクごとの列 + rest + user。ランク無しが現れた以降は rest に落とす', () => {
        const r = {
            groups: [
                { id: 1, name: 'hq', displayName: '本部', rank: 0 },
                { id: 2, name: 'sales', displayName: '営業部', rank: 1 },
                { id: 3, name: 'sec1', displayName: '一課', rank: 2 },
                { id: 4, name: 'newdept', displayName: '新設部' },
                { id: 5, name: 'pj', displayName: 'PJ' },
            ],
            edges: [
                { groupId: 1, subjectKind: 'group' as const, subjectId: '2', name: '営業部' },
                { groupId: 1, subjectKind: 'group' as const, subjectId: '4', name: '新設部' },
                { groupId: 1, subjectKind: 'group' as const, subjectId: '5', name: 'PJ' },
                { groupId: 2, subjectKind: 'group' as const, subjectId: '3', name: '一課' },
                { groupId: 4, subjectKind: 'group' as const, subjectId: '3', name: '一課' },
                { groupId: 3, subjectKind: 'user' as const, subjectId: 'g1', name: '田中', username: 'tanaka' },
            ],
        };
        const tree = buildExportTree(r);
        expect(tree[0].rank).toBe(0);
        expect(tree[0].children?.[1].rank).toBeUndefined();
        expect(exportRankRows(tree)).toEqual([
            ['rank0', 'rank1', 'rank2', 'rest', 'user'],
            ['hq', 'sales', 'sec1', '', 'tanaka'],
            ['hq', '', '', 'newdept>sec1', 'tanaka'],
            ['hq', '', '', 'pj', ''],
        ]);
    });
    it('CSV(rank): 順序が逆のランク(保険)は rest に落とす', () => {
        const r = {
            groups: [
                { id: 1, name: 'A', displayName: 'A', rank: 2 },
                { id: 2, name: 'B', displayName: 'B', rank: 1 },
            ],
            edges: [{ groupId: 1, subjectKind: 'group' as const, subjectId: '2', name: 'B' }],
        };
        expect(exportRankRows(buildExportTree(r))).toEqual([
            ['rank0', 'rank1', 'rank2', 'rest', 'user'],
            ['', '', 'A', 'B', ''],
        ]);
    });
});
