import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'data', 'ftool-users-extra.tsv');
let seed = 20261021;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const surnames = [
    ['aoki', '青木'], ['ishii', '石井'], ['ueda', '上田'], ['endo', '遠藤'], ['ota', '太田'], ['okamoto', '岡本'],
    ['kaneko', '金子'], ['kikuchi', '菊池'], ['kudo', '工藤'], ['kono', '河野'], ['sakai', '坂井'], ['sakamoto', '坂本'],
    ['shibata', '柴田'], ['sugiyama', '杉山'], ['takeda', '武田'], ['tamura', '田村'], ['chiba', '千葉'], ['tsuchiya', '土屋'],
    ['nagai', '永井'], ['noguchi', '野口'], ['harada', '原田'], ['hirano', '平野'], ['fukuda', '福田'], ['masuda', '増田'],
    ['miura', '三浦'], ['miyazaki', '宮崎'], ['murata', '村田'], ['yokoyama', '横山'], ['wada', '和田'], ['watabe', '渡部'],
];
const givens = [
    ['kenta', '健太'], ['misaki', '美咲'], ['daiki', '大樹'], ['yui', '結衣'], ['ryota', '亮太'], ['hina', '陽菜'],
    ['sota', '颯太'], ['aoi', '葵'], ['yuto', '悠人'], ['rin', '凛'], ['haruto', '陽翔'], ['mei', '芽依'],
];
const departments = [
    '営業本部営業一部一課', '営業本部営業一部二課', '営業本部営業二部一課', '営業本部営業二部二課', '営業本部営業推進室',
    '技術本部開発部一課', '技術本部開発部二課', '技術本部開発部三課', '技術本部品質保証部', '技術本部基盤技術部',
    '管理本部総務部', '管理本部人事部', '管理本部経理部', '管理本部情報システム部', '管理本部法務室',
];
const titles = ['担当', '担当', '担当', '担当', '主任', '主任', '係長', '課長'];
const rows = [];
const used = new Set();
let empNo = 20001;
for (let i = 0; rows.length < 100; i++) {
    const [sam, sj] = pick(surnames);
    const [gv, gj] = pick(givens);
    const username = `${sam}.${gv}`;
    if (used.has(username))
        continue;
    used.add(username);
    const no = String(empNo++);
    const r = rand();
    let description;
    if (r < 0.7)
        description = no;
    else if (r < 0.8)
        description = 'b' + no.slice(1);
    else if (r < 0.9)
        description = pick([`${no} ${pick(titles)}`, `社員 ${no}`, `${no}(出向)`]);
    else if (r < 0.95)
        description = pick(['派遣スタッフ', '契約社員', '業務委託']);
    else
        description = 'x' + no + '1';
    const disabled = rand() < 0.05 ? 'disabled' : '';
    rows.push([username, gv, sam, `${sj} ${gj}`, no, `${username}@example.local`, pick(departments), pick(titles), description, disabled].join('\t'));
}
const header = `# deploy/samba/data/ftool-users-extra.tsv(gen-extra-users.mjs が生成。手で編集しない)
# F-tool に未登録のユーザー約 100 名。[AD から追加]の検索・上限・社員番号の抽出・無効化の除外を試すためのデータ。
# dev-seed-users.mjs(台帳登録)の対象には含めない。パスワードは全員 Fidev01!
# 列: sAMAccountName / givenName / surname / displayName / employeeID / mail / department / title / description / flags(disabled)
`;
fs.writeFileSync(out, header + rows.join('\n') + '\n');
console.log(`wrote ${rows.length} users -> ${out}`);
