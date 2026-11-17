function matchPeople(people, days, capacities, balanceFrom = null) {
  const source = 0,
    firstDay = people.length + 1,
    sink = firstDay + days.length;
  const graph = Array.from({ length: sink + 1 }, () => []);
  function edge(from, to, capacity, cost) {
    const forward = { to, capacity, cost, reverse: graph[to].length };
    graph[from].push(forward);
    graph[to].push({ to: from, capacity: 0, cost: -cost, reverse: graph[from].length - 1 });
    return forward;
  }
  const choices = people.map((person, index) => {
    edge(source, index + 1, 1, 0);
    return person.options.map((option) => ({
      option,
      edge: edge(
        index + 1,
        firstDay + days.indexOf(option.businessDate),
        1,
        option.cost ?? Number(option.conflict)
      )
    }));
  });
  capacities.forEach((capacity, index) => {
    if (!balanceFrom) edge(firstDay + index, sink, capacity, 0);
    else
      for (let slot = 0; slot < capacity; slot++)
        edge(
          firstDay + index,
          sink,
          1,
          (2 * (balanceFrom[index] + slot) + 1) * (people.length + 1)
        );
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
    if (!previous[sink]) break;
    for (let target = sink; target !== source; ) {
      const { from, index } = previous[target];
      const link = graph[from][index];
      link.capacity--;
      graph[target][link.reverse].capacity++;
      target = from;
    }
    flow++;
  }
  return {
    items: choices.flatMap((options, index) =>
      options
        .filter((choice) => choice.edge.capacity === 0)
        .map((choice) => ({ ...choice.option, person: people[index] }))
    ),
    complete: flow === people.length
  };
}

function balancedLoads(total, fixed) {
  const count = fixed.length;
  if (!count) return [];
  const unique = new Map();
  function fill(lower, values, remaining) {
    if (values.length === count) {
      if (!remaining) unique.set(values.join(','), values);
      return;
    }
    const minimum = Math.max(lower, fixed[values.length]);
    for (let value = minimum; value <= Math.min(lower + 2, remaining); value++)
      fill(lower, [...values, value], remaining - value);
  }
  for (
    let lower = Math.max(0, Math.ceil(total / count) - 2);
    lower <= Math.floor(total / count);
    lower++
  )
    fill(lower, [], total);
  return [...unique.values()];
}

export function balancedPlans(people, days, fixed) {
  const total = people.length + fixed.reduce((sum, value) => sum + value, 0);
  const plans = balancedLoads(total, fixed).flatMap((loads) => {
    const matched = matchPeople(
      people,
      days,
      loads.map((value, index) => value - fixed[index])
    );
    return matched.complete ? [{ ...matched, loads }] : [];
  });
  if (plans.length) return plans;
  const fallback = matchPeople(
    people,
    days,
    days.map(() => people.length),
    fixed
  );
  return [
    {
      ...fallback,
      loads: days.map(
        (day, index) =>
          fixed[index] + fallback.items.filter((row) => row.businessDate === day).length
      )
    }
  ];
}

export function comparePlans(first, second) {
  for (let index = 0; index < first.length; index++) {
    if (first[index] !== second[index]) return first[index] - second[index];
  }
  return 0;
}

export function officePlan(people, days) {
  const slots = people.flatMap((person) =>
    Array.from({ length: person.weeklyOnce ? 1 : days.length }, (_, index) => ({
      ...person,
      options: person.options.map((option) => ({
        ...option,
        cost: (index + (person.officeLoad || 0)) * (people.length + 1) + Number(!person.weeklyOnce)
      }))
    }))
  );
  return matchPeople(
    slots,
    days,
    days.map(() => 1)
  ).items;
}
