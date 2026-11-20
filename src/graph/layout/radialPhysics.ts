type Point = { x: number; y: number };
type Body = Point & { id: string; fx: number | null; fy: number | null };
type Edge = { child: string; parent: string; angle: number; length: number };
type Motion = { vx: number; vy: number; fixed: boolean; anchor?: Point };

const angleDifference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const outside = (value: number, slack: number) => Math.sign(value) * Math.max(0, Math.abs(value) - slack);

export class RadialPhysics {
    private motion = new Map<string, Motion>();
    private edges = new Map<string, Edge>();
    private quietFrames = 0;
    private spacing = 220;

    configure(seeds: ReadonlyMap<string, Point>, parents: ReadonlyMap<string, string>, spacing: number) {
        for (const id of this.motion.keys()) if (!seeds.has(id)) this.motion.delete(id);
        this.edges.clear();
        for (const [child, parent] of parents) {
            const a = seeds.get(parent)!;
            const b = seeds.get(child)!;
            this.edges.set(child, {
                child, parent, angle: Math.atan2(b.y - a.y, b.x - a.x),
                length: Math.min(spacing * 2.5, Math.hypot(b.x - a.x, b.y - a.y))
            });
        }
        this.spacing = spacing;
        this.quietFrames = 0;
    }

    sync(nodes: readonly Body[], seeds: ReadonlyMap<string, Point>): boolean {
        let changed = false;
        for (const node of nodes) {
            const seed = seeds.get(node.id);
            if (!seed) continue;
            const fixed = node.fx !== null && node.fy !== null;
            const previous = this.motion.get(node.id);
            if (!previous) {
                node.x = fixed ? node.fx! : seed.x;
                node.y = fixed ? node.fy! : seed.y;
                this.motion.set(node.id, { vx: 0, vy: 0, fixed });
                changed = true;
            } else if (previous.fixed !== fixed || (fixed && (node.x !== node.fx || node.y !== node.fy))) {
                previous.fixed = fixed;
                previous.vx = previous.vy = 0;
                if (fixed) {
                    node.x = node.fx!;
                    node.y = node.fy!;
                }
                changed = true;
            }
            const motion = this.motion.get(node.id)!;
            if (this.edges.has(node.id)) motion.anchor = undefined;
            else if (fixed || !motion.anchor) motion.anchor = { x: node.x, y: node.y };
        }
        if (changed) this.quietFrames = 0;
        return changed;
    }

    step(nodes: readonly Body[], frames = 1): boolean {
        if (this.quietFrames >= 8) return false;
        const bodies = new Map(nodes.map(node => [node.id, node]));
        for (let i = 0; i < frames && this.quietFrames < 8; i++) {
            this.applyBranchForces(bodies);
            this.repelNeighbors(nodes);
            let moving = false;
            for (const node of nodes) {
                const motion = this.motion.get(node.id);
                if (!motion || motion.fixed) continue;
                if (motion.anchor) {
                    motion.vx += (motion.anchor.x - node.x) * 0.003;
                    motion.vy += (motion.anchor.y - node.y) * 0.003;
                }
                const speed = Math.hypot(motion.vx, motion.vy);
                const limit = Math.min(1, this.spacing * 0.15 / (speed || 1));
                const vx = motion.vx * limit;
                const vy = motion.vy * limit;
                node.x += vx;
                node.y += vy;
                motion.vx = vx * 0.76;
                motion.vy = vy * 0.76;
                moving ||= Math.abs(vx) + Math.abs(vy) > 0.08;
            }
            this.quietFrames = moving ? 0 : this.quietFrames + 1;
        }
        if (frames > 1) this.quietFrames = 8;
        return true;
    }

    private applyBranchForces(bodies: ReadonlyMap<string, Body>) {
        const headings = new Map<string, Point>();
        for (const { child, parent, angle } of this.edges.values()) {
            if (this.edges.has(parent)) continue;
            const a = bodies.get(parent);
            const b = bodies.get(child);
            if (!a || !b || (a.x === b.x && a.y === b.y)) continue;
            const rotation = Math.atan2(b.y - a.y, b.x - a.x) - angle;
            const sum = headings.get(parent) ?? { x: 0, y: 0 };
            sum.x += Math.cos(rotation);
            sum.y += Math.sin(rotation);
            headings.set(parent, sum);
        }
        for (const edge of this.edges.values()) {
            const a = bodies.get(edge.parent);
            const b = bodies.get(edge.child);
            if (!a || !b) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const length = Math.hypot(dx, dy);
            if (length < 0.001) continue;
            const incoming = this.edges.get(edge.parent);
            const grandparent = incoming && bodies.get(incoming.parent);
            const heading = headings.get(edge.parent);
            const preferred = grandparent && incoming
                ? Math.atan2(a.y - grandparent.y, a.x - grandparent.x) + angleDifference(edge.angle, incoming.angle)
                : edge.angle + (heading ? Math.atan2(heading.y, heading.x) : 0);
            const turn = outside(angleDifference(preferred, Math.atan2(dy, dx)), Math.PI / 10);
            const lengthForce = outside(edge.length - length, edge.length * 0.17) * 0.025;
            const turnForce = turn * Math.min(length, this.spacing) * 0.034;
            this.pushApart(a, b, (dx * lengthForce - dy * turnForce) / length, (dy * lengthForce + dx * turnForce) / length);
        }
    }

    private repelNeighbors(nodes: readonly Body[]) {
        const distance = this.spacing * 0.42;
        const cells = new Map<string, Body[]>();
        for (const node of nodes) {
            const column = Math.floor(node.x / distance);
            const row = Math.floor(node.y / distance);
            for (let x = column - 1; x <= column + 1; x++) {
                for (let y = row - 1; y <= row + 1; y++) {
                    for (const other of cells.get(`${x},${y}`) ?? []) {
                        let dx = node.x - other.x;
                        const dy = node.y - other.y;
                        if (dx === 0 && dy === 0) dx = 0.01;
                        const gap = Math.hypot(dx, dy);
                        if (gap >= distance) continue;
                        const push = (distance - gap) * 0.035 / gap;
                        this.pushApart(other, node, dx * push, dy * push);
                    }
                }
            }
            const key = `${column},${row}`;
            if (!cells.has(key)) cells.set(key, []);
            cells.get(key)!.push(node);
        }
    }

    private pushApart(a: Body, b: Body, x: number, y: number) {
        const first = this.motion.get(a.id);
        const second = this.motion.get(b.id);
        if (first && !first.fixed) {
            first.vx -= x;
            first.vy -= y;
        }
        if (second && !second.fixed) {
            second.vx += x;
            second.vy += y;
        }
    }
}
