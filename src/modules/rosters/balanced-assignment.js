function matchPeople(people, slots, costs) {
  const source = 0,
    firstSlot = people.length + 1,
    sink = firstSlot + slots.length;
  const graph = Array.from({ length: sink + 1 }, () => []);
  const slotIndex = new Map(
    slots.map((slot, index) => [`${slot.dutyType}:${slot.businessDate}`, firstSlot + index])
  );
  function edge(from, to, capacity, cost) {
    const forward = { to, capacity, cost, reverse: graph[to].length };
    graph[from].push(forward);
    graph[to].push({ to: from, capacity: 0, cost: -cost, reverse: graph[from].length - 1 });
    return forward;
  }
  const choices = people.map((person, index) => {
    const from = index + 1;
    edge(source, from, 1, 0);
    if (!person.needsWeeklyShift) edge(from, sink, 1, 0);
    return person.options.flatMap((option) => {
      const to = slotIndex.get(`${option.dutyType}:${option.businessDate}`);
      if (to === undefined) return [];
      const cost = option.dutyType === 'office'
        ? -costs.office - (person.needsWeeklyShift ? costs.dualOffice : 0)
        : Number(option.conflict) * costs.conflict;
      return [{ option, edge: edge(from, to, 1, cost) }];
    });
  });
  const requiredEdges = [];
  slots.forEach((slot, index) => {
    const from = firstSlot + index;
    if (slot.dutyType === 'office') {
      edge(from, sink, 1, 0);
      return;
    }
    for (let count = slot.fixed; count < slot.upper; count++) {
      const required = count < slot.lower;
      const cost = 2 * count + 1 - (count === 0 ? costs.repairDay : 0);
      const link = edge(from, sink, 1, cost - (required ? costs.requiredSeat : 0));
      if (required) requiredEdges.push(link);
    }
  });
  let flow = 0;
  while (flow < people.length) {
    const distance = Array(graph.length).fill(Infinity),
      previous = Array(graph.length).fill(null);
    const queue = [source],
      queued = new Set(queue);
    distance[source] = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const from = queue[cursor];
      queued.delete(from);
      graph[from].forEach((link, index) => {
        if (!link.capacity || distance[link.to] <= distance[from] + link.cost) return;
        distance[link.to] = distance[from] + link.cost;
        previous[link.to] = { from, index };
        if (!queued.has(link.to)) {
          queue.push(link.to);
          queued.add(link.to);
        }
      });
    }
    if (!previous[sink]) return null;
    for (let target = sink; target !== source; ) {
      const { from, index } = previous[target];
      const link = graph[from][index];
      link.capacity--;
      graph[target][link.reverse].capacity++;
      target = from;
    }
    flow++;
  }
  if (requiredEdges.some((link) => link.capacity)) return null;
  return choices.flatMap((options, index) =>
    options
      .filter((choice) => choice.edge.capacity === 0)
      .map((choice) => ({ ...choice.option, person: people[index] }))
  );
}

function comparePlans(first, second) {
  for (let index = 0; index < first.length; index++) {
    if (first[index] !== second[index]) return first[index] - second[index];
  }
  return 0;
}

export function bestDutyPlan(people, days, officeDays, fixedRepair, maxSpread) {
  const required = people.filter((person) => person.needsWeeklyShift).length;
  const fixedTotal = fixedRepair.reduce((sum, count) => sum + count, 0);
  const mostRepair = fixedTotal + required;
  const leastRepair = Math.max(fixedTotal, mostRepair - officeDays.length);
  const repairDay = mostRepair ** 2 + 1;
  const dualOffice = (days.length + 1) * repairDay;
  const conflict = (officeDays.length + 1) * dualOffice;
  const office = (required + 1) * conflict;
  const costs = { repairDay, dualOffice, conflict, office, requiredSeat: (officeDays.length + 1) * office };
  const officeSlots = officeDays.map((businessDate) => ({ businessDate, dutyType: 'office' }));
  const firstLower = Math.max(0, Math.ceil(leastRepair / days.length) - maxSpread);
  const lastLower = Math.floor(mostRepair / days.length);
  let best = null;
  for (let lower = firstLower; lower <= lastLower; lower++) {
    const upper = lower + maxSpread;
    if (fixedRepair.some((count) => count > upper)) continue;
    const repairSlots = days.map((businessDate, index) => ({
      businessDate, dutyType: 'repair', lower, upper, fixed: fixedRepair[index]
    }));
    const items = matchPeople(people, [...officeSlots, ...repairSlots], costs);
    if (!items) continue;
    const offices = items.filter((row) => row.dutyType === 'office');
    const repairLoads = days.map((day, index) => fixedRepair[index] + items.filter(
      (row) => row.dutyType === 'repair' && row.businessDate === day
    ).length);
    const conflicts = items.filter((row) => row.conflict).length;
    const score = [
      -offices.length,
      conflicts,
      -offices.filter((row) => row.person.needsWeeklyShift).length,
      repairLoads.filter((count) => count === 0).length,
      repairLoads.reduce((sum, count) => sum + count ** 2, 0)
    ];
    if (!best || comparePlans(score, best.score) < 0) best = { items, conflicts, score };
  }
  return best;
}
