export class SolverBudgetExceeded extends Error {}

export class SolverBudget {
  work = 0;
  runs = 0;
  readonly limit: number;
  constructor(limit: number) { this.limit = limit; }
  consume(amount = 1) {
    this.work += amount;
    if (this.work > this.limit) throw new SolverBudgetExceeded();
  }
}

type Edge = {to: number; reverse: number; capacity: number; cost: number};
export type FlowEdge = {edge: Edge; initial: number; lower: number};

// Integral lower-bounded min-cost circulation. Lower bounds become demands;
// successive shortest augmenting paths satisfy them using residual edges.
// The caller supplies a layered initial network, so it has no negative cycle.
export class BoundedFlow {
  private graph: Edge[][] = [];
  private balance: number[] = [];
  private possible = true;
  private budget: SolverBudget;
  constructor(budget: SolverBudget) { this.budget = budget; }
  node() {
    const id = this.graph.length;
    this.graph.push([]); this.balance.push(0); return id;
  }
  private residual(from: number, to: number, capacity: number, cost: number): Edge {
    const edge = {to, reverse: this.graph[to].length, capacity, cost};
    const reverse = {to: from, reverse: this.graph[from].length, capacity: 0, cost: -cost};
    this.graph[from].push(edge); this.graph[to].push(reverse); return edge;
  }
  edge(from: number, to: number, lower: number, upper: number, cost = 0): FlowEdge {
    if (lower < 0 || upper < lower) this.possible = false;
    this.balance[from] -= lower; this.balance[to] += lower;
    const capacity = Math.max(0, upper - lower);
    return {edge: this.residual(from, to, capacity, cost), initial: capacity, lower};
  }
  used(reference: FlowEdge) {return reference.lower + reference.initial - reference.edge.capacity;}
  solve() {
    this.budget.runs++;
    if (!this.possible) return false;
    const source = this.node(), sink = this.node();
    let required = 0;
    for (let node = 0; node < source; node++) {
      if (this.balance[node] > 0) {this.residual(source,node,this.balance[node],0); required += this.balance[node];}
      if (this.balance[node] < 0) this.residual(node,sink,-this.balance[node],0);
    }
    let sent = 0;
    while (sent < required) {
      const distance = Array(this.graph.length).fill(Infinity), previousNode = Array(this.graph.length).fill(-1), previousEdge = Array(this.graph.length).fill(-1);
      const queued = Array(this.graph.length).fill(false), queue = [source];
      distance[source] = 0; queued[source] = true;
      for (let index = 0; index < queue.length; index++) {
        const node = queue[index]; queued[node] = false;
        for (let edgeIndex = 0; edgeIndex < this.graph[node].length; edgeIndex++) {
          this.budget.consume();
          const edge = this.graph[node][edgeIndex];
          if (!edge.capacity || distance[edge.to] <= distance[node] + edge.cost) continue;
          distance[edge.to] = distance[node] + edge.cost;
          previousNode[edge.to] = node; previousEdge[edge.to] = edgeIndex;
          if (!queued[edge.to]) {queue.push(edge.to); queued[edge.to] = true;}
        }
      }
      if (!Number.isFinite(distance[sink])) return false;
      let amount = required - sent;
      for (let node = sink; node !== source; node = previousNode[node]) amount = Math.min(amount, this.graph[previousNode[node]][previousEdge[node]].capacity);
      for (let node = sink; node !== source; node = previousNode[node]) {
        const edge = this.graph[previousNode[node]][previousEdge[node]];
        edge.capacity -= amount; this.graph[node][edge.reverse].capacity += amount;
      }
      sent += amount;
    }
    return true;
  }
}
