-- Remember progress separately from a period's reopenable collection state.
-- Reopening historical fill-in never rewinds or advances the active period.
ALTER TABLE roster_collection_series ADD COLUMN current_week TEXT NOT NULL DEFAULT '';
UPDATE roster_collection_series SET current_week=COALESCE((SELECT MAX(week_start)
FROM roster_tasks WHERE series_id=roster_collection_series.id),'');
