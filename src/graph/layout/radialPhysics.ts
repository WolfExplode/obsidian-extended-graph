type Point = { x: number; y: number };
type Body = Point & { id: string; fx: number | null; fy: number | null; getSize(): number };
type ParentEdge = { child: string; parent: string };
type Edge = ParentEdge & { angle: number; length: number };
type Motion = {
    vx: number; vy: number; forceX: number; forceY: number;
    fixed: boolean; inverseMass: number; anchor?: Point;
};

const BASE_NODE_RADIUS = 8;
const MAX_ANGULAR_SPEED = 0.06; // Radians per simulation step for a standard node.
const angleDifference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const outside = (value: number, slack: number) => Math.sign(value) * Math.max(0, Math.abs(value) - slack);

export class RadialPhysics {
    private motion = new Map<string, Motion>();
    private edges = new Map<string, Edge>();
    private additionalEdges: ParentEdge[] = [];
    private quietFrames = 0;
    private spacing = 220;

    configure(
        seeds: ReadonlyMap<string, Point>,
        parents: ReadonlyMap<string, string>,
        additionalParents: ReadonlyMap<string, ReadonlySet<string>>,
        spacing: number
    ) {
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
        this.additionalEdges = [];
        for (const [child, ids] of additionalParents) {
            for (const parent of ids) {
                // Reciprocal parent links share a single physical connection.
                if (parents.get(parent) === child || (child > parent && additionalParents.get(parent)?.has(child))) continue;
                this.additionalEdges.push({ child, parent });
            }
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
            const size = node.getSize();
            const radius = Number.isFinite(size) && size > 0 ? size : BASE_NODE_RADIUS;
            // Scale inertia with the node's area, with a minimum mass for tiny nodes.
            const inverseMass = 1 / (1 + (radius / BASE_NODE_RADIUS) ** 2);
            let motion = this.motion.get(node.id);
            if (!motion) {
                node.x = fixed ? node.fx! : seed.x;
                node.y = fixed ? node.fy! : seed.y;
                motion = { vx: 0, vy: 0, forceX: 0, forceY: 0, fixed, inverseMass };
                this.motion.set(node.id, motion);
                changed = true;
            } else if (motion.fixed !== fixed || (fixed && (node.x !== node.fx || node.y !== node.fy))) {
                motion.fixed = fixed;
                motion.vx = motion.vy = 0;
                if (fixed) {
                    node.x = node.fx!;
                    node.y = node.fy!;
                }
                changed = true;
            }
            if (motion.inverseMass !== inverseMass) {
                motion.inverseMass = inverseMass;
                changed = true;
            }
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
            this.attractAdditionalParents(bodies);
            this.repelNeighbors(nodes);
            this.integrateVelocities(bodies);
            let moving = false;
            for (const node of nodes) {
                const motion = this.motion.get(node.id);
                if (!motion || motion.fixed) continue;
                node.x += motion.vx;
                node.y += motion.vy;
                moving ||= Math.abs(motion.vx) + Math.abs(motion.vy) > 0.08;
                motion.vx *= 0.76;
                motion.vy *= 0.76;
            }
            this.quietFrames = moving ? 0 : this.quietFrames + 1;
        }
        if (frames > 1) this.quietFrames = 8;
        return true;
    }

    private integrateVelocities(bodies: ReadonlyMap<string, Body>) {
        for (const node of bodies.values()) {
            const motion = this.motion.get(node.id);
            if (!motion || motion.fixed) continue;
            if (motion.anchor) {
                motion.forceX += (motion.anchor.x - node.x) * 0.003;
                motion.forceY += (motion.anchor.y - node.y) * 0.003;
            }

            const { forceX, forceY, inverseMass } = motion;
            let vx = motion.vx + forceX * inverseMass;
            let vy = motion.vy + forceY * inverseMass;
            const edge = this.edges.get(node.id);
            const parent = edge && bodies.get(edge.parent);
            if (parent) {
                const dx = node.x - parent.x;
                const dy = node.y - parent.y;
                const radius = Math.hypot(dx, dy);
                if (radius >= 0.001) {
                    const tangentX = -dy / radius;
                    const tangentY = dx / radius;
                    // Moment of inertia grows with both mass and the square of the node's size.
                    const angularMobility = Math.min(1, 2 * inverseMass);
                    const acceleration = (forceX * tangentX + forceY * tangentY) * inverseMass;
                    const tangentSpeed = vx * tangentX + vy * tangentY;
                    const nextTangentSpeed = tangentSpeed - acceleration * (1 - angularMobility);
                    const maxTangentSpeed = radius * MAX_ANGULAR_SPEED * angularMobility;
                    const correction = Math.max(-maxTangentSpeed, Math.min(maxTangentSpeed, nextTangentSpeed)) - tangentSpeed;
                    vx += tangentX * correction;
                    vy += tangentY * correction;
                }
            }

            const speed = Math.hypot(vx, vy);
            const maxSpeed = this.spacing * 0.15 * Math.sqrt(inverseMass);
            const limit = speed > maxSpeed ? maxSpeed / speed : 1;
            motion.vx = vx * limit;
            motion.vy = vy * limit;
            motion.forceX = motion.forceY = 0;
        }
    }

    private attractAdditionalParents(bodies: ReadonlyMap<string, Body>) {
        const restLength = this.spacing * 0.75;
        for (const { child, parent } of this.additionalEdges) {
            const a = bodies.get(parent);
            const b = bodies.get(child);
            if (!a || !b) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const length = Math.hypot(dx, dy);
            if (length <= restLength) continue;
            // A weak, capped pull lets branches move together without flattening the radial layout.
            const pull = Math.min(length - restLength, this.spacing) * 0.004 / length;
            this.pushApart(a, b, -dx * pull, -dy * pull);
        }
    }

    private applyBranchForces(bodies: ReadonlyMap<string, Body>) {
        for (const edge of this.edges.values()) {
            const a = bodies.get(edge.parent);
            const b = bodies.get(edge.child);
            if (!a || !b) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const length = Math.hypot(dx, dy);
            if (length < 0.001) continue;
            // A fork keeps its resting angle relative to the limb it grows from.
            const incoming = this.edges.get(a.id);
            const trunk = incoming && bodies.get(incoming.parent);
            let targetAngle = edge.angle;
            let inX = 0;
            let inY = 0;
            let inLength = 0;
            if (incoming && trunk) {
                inX = a.x - trunk.x;
                inY = a.y - trunk.y;
                inLength = Math.hypot(inX, inY);
                if (inLength > 0.001) {
                    targetAngle += angleDifference(Math.atan2(inY, inX), incoming.angle);
                }
            }

            const slack = incoming ? Math.PI / 24 : Math.PI / 36;
            const bend = outside(angleDifference(targetAngle, Math.atan2(dy, dx)), slack);
            const lever = Math.min(length, inLength || length, this.spacing);
            const torque = bend * lever * lever * 0.055;
            const stretch = outside(edge.length - length, edge.length * 0.08) * 0.055;
            const tangent = torque / (length * length);
            this.pushApart(a, b, dx * stretch / length - dy * tangent, dy * stretch / length + dx * tangent);
            // Apply the opposite torque to the incoming limb so dragging a tip bends the joint too.
            if (trunk && inLength > 0.001) {
                const reaction = torque / (inLength * inLength);
                this.pushApart(trunk, a, inY * reaction, -inX * reaction);
            }
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
        this.addForce(a, -x, -y);
        this.addForce(b, x, y);
    }

    private addForce(node: Body, x: number, y: number) {
        const motion = this.motion.get(node.id);
        if (!motion || motion.fixed) return;
        motion.forceX += x;
        motion.forceY += y;
    }
}
