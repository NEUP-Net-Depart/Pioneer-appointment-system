-- Convert once to the sole runtime signature format. Old normalized arrays did
-- not record their source dimensions; use the historical detail view's 560:200
-- coordinate space. Original stroke/point order and normalized positions remain.
UPDATE appointments
SET signature = json_object(
  'version', 2, 'width', 560, 'height', 200,
  'strokes', json((
    SELECT json_group_array(json(converted_stroke)) FROM (
      SELECT (
        SELECT json_group_array(json(converted_point)) FROM (
          SELECT json_array(
            json_extract(point.value, '$[0]') * 560.0,
            json_extract(point.value, '$[1]') * 200.0
          ) AS converted_point
          FROM json_each(stroke.value) AS point ORDER BY point.key
        )
      ) AS converted_stroke
      FROM json_each(appointments.signature) AS stroke ORDER BY stroke.key
    )
  ))
)
WHERE CASE WHEN json_valid(signature) THEN json_type(signature) = 'array' ELSE 0 END;
