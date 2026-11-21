import type { RadialLinkSettings } from "../../settings/settings";

type Point = { x: number; y: number };
type Branch = {
    id: string;
    children: Branch[];
    leaves: number;
    angle: number;
};

function buildRadialTree(
    root: string, links: ReadonlyMap<string, readonly string[]>, spacing: number,
    tiers: Map<string, number>, descendants: Map<string, number>
) {
    const trunk: Branch = { id: root, children: [], leaves: 1, angle: 0 };
    tiers.set(root, 0);
    const branches = [trunk];
    const parents = new Map<string, string>();
    for (const branch of branches) {
        for (const id of links.get(branch.id) ?? []) {
            if (tiers.has(id)) continue;
            tiers.set(id, tiers.get(branch.id)! + 1);
            const child: Branch = { id, children: [], leaves: 1, angle: 0 };
            parents.set(id, branch.id);
            branch.children.push(child);
            branches.push(child);
        }
    }
    for (let i = branches.length - 1; i >= 0; --i) {
        const branch = branches[i];
        let descendantCount = 0;
        let leafCount = 0;
        for (const child of branch.children) {
            descendantCount += 1 + descendants.get(child.id)!;
            leafCount += child.leaves;
        }
        descendants.set(branch.id, descendantCount);
        branch.leaves = Math.max(1, leafCount);
    }

    const positions = new Map<string, Point>([[root, { x: 0, y: 0 }]]);
    let level = [{ branch: trunk, width: 2 * Math.PI }];
    let radius = 0;
    const maxBranchSector = Math.PI / 3;
    const maxTurnFromRadial = Math.PI / 4;
    while (level.length) {
        let nextRadius = radius + spacing;
        const next = level.flatMap(({ branch, width }) => {
            let start = branch.angle - width / 2;
            return branch.children.map(child => {
                // Give wide subtrees more room while reserving space for every sibling.
                const share = (child.leaves / branch.leaves + 1 / branch.children.length) / 2;
                const sector = width * share;
                child.angle = start + sector / 2;
                start += sector;
                if (radius > 0) {
                    const bend = Math.abs(child.angle - branch.angle);
                    nextRadius = Math.max(nextRadius, radius / (Math.cos(bend) - Math.sin(bend) / Math.tan(maxTurnFromRadial)));
                }
                return { branch: child, width: Math.min(sector, maxBranchSector) };
            });
        });

        // Expand crowded rings so neighboring branches have room to separate.
        for (let i = 0; i < next.length && next.length > 1; ++i) {
            const left = next[i].branch.angle;
            const right = i + 1 < next.length ? next[i + 1].branch.angle : next[0].branch.angle + 2 * Math.PI;
            const gap = Math.min(right - left, Math.PI);
            if (gap > 0) nextRadius = Math.max(nextRadius, Math.min(4 * (radius + spacing), 42 / (2 * Math.sin(gap / 2))));
        }

        for (const { branch } of next) {
            positions.set(branch.id, { x: Math.cos(branch.angle) * nextRadius, y: Math.sin(branch.angle) * nextRadius });
        }
        level = next;
        radius = nextRadius;
    }
    return { parents, positions };
}

export function buildRadialForest(ids: string[], links: ReadonlyMap<string, readonly string[]>, spacing: number) {
    const hasParent = new Set<string>();
    for (const [parent, children] of links) {
        for (const child of children) if (child !== parent) hasParent.add(child);
    }
    const order = [...ids].sort((a, b) => Number(hasParent.has(a)) - Number(hasParent.has(b))
        || (links.get(b)?.length ?? 0) - (links.get(a)?.length ?? 0) || a.localeCompare(b));
    const tiers = new Map<string, number>();
    const descendants = new Map<string, number>();
    const parents = new Map<string, string>();
    const trees = [];
    const gap = spacing * 0.35;
    for (const root of order) {
        if (tiers.has(root)) continue;
        const tree = buildRadialTree(root, links, spacing, tiers, descendants);
        let radius = gap / 2;
        for (const point of tree.positions.values()) radius = Math.max(radius, Math.hypot(point.x, point.y));
        for (const [child, parent] of tree.parents) parents.set(child, parent);
        trees.push({ positions: tree.positions, radius });
    }
    trees.sort((a, b) => b.positions.size - a.positions.size || b.radius - a.radius);
    const main = trees.shift();
    if (!main) return { parents, positions: new Map<string, Point>(), tiers, descendants };

    const positions = main.positions;
    trees.sort((a, b) => b.radius - a.radius);
    let outerEdge = main.radius;
    let rotation = 0;
    for (let start = 0; start < trees.length;) {
        const largest = trees[start].radius;
        const ring = outerEdge + gap + largest;
        const capacity = Math.floor(Math.PI / Math.asin((largest + gap / 2) / ring));
        let count = 1;
        while (count < capacity && start + count < trees.length && trees[start + count].radius >= largest / 2) count++;
        for (let i = 0; i < count; i++) {
            const angle = rotation + (i + 0.5) * 2 * Math.PI / count;
            const offsetX = ring * Math.cos(angle);
            const offsetY = ring * Math.sin(angle);
            for (const [id, point] of trees[start + i].positions) {
                positions.set(id, { x: point.x + offsetX, y: point.y + offsetY });
            }
        }
        start += count;
        outerEdge = ring + largest;
        rotation += Math.PI * (3 - Math.sqrt(5));
    }
    return { parents, positions, tiers, descendants };
}

function indexParents(children: ReadonlyMap<string, readonly string[]>) {
    const parentsByChild = new Map<string, Set<string>>();
    for (const [parent, ids] of children) {
        for (const child of ids) {
            if (!parentsByChild.has(child)) parentsByChild.set(child, new Set());
            parentsByChild.get(child)!.add(parent);
        }
    }
    return parentsByChild;
}

export function selectAdditionalParents(
    children: ReadonlyMap<string, readonly string[]>,
    primaryParents: ReadonlyMap<string, string>,
    tiers: ReadonlyMap<string, number>,
    selection: RadialLinkSettings["parentSelection"],
    candidates = children
) {
    const declaredParents = indexParents(children);
    const eligibleParents = candidates === children ? declaredParents : indexParents(candidates);
    const additionalParents = new Map<string, Set<string>>();
    for (const [child, parents] of eligibleParents) {
        const primary = primaryParents.get(child);
        const expectedTier = tiers.get(child)! - 1;
        const distance = (parent: string) => Math.abs(tiers.get(parent)! - expectedTier);
        // The breadth-first tree parent always has distance zero. Roots can only have fallback links.
        let bestDistance = primary !== undefined ? 0 : Infinity;
        if (selection === "tier" && primary === undefined) {
            for (const parent of parents) bestDistance = Math.min(bestDistance, distance(parent));
        }
        const additional = new Set<string>();
        for (const parent of parents) {
            if (parent !== primary && (selection !== "tier" || distance(parent) === bestDistance)) additional.add(parent);
        }
        if (additional.size) additionalParents.set(child, additional);
    }
    return { declaredParents, additionalParents };
}

