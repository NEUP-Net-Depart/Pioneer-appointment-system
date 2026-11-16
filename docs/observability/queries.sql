-- Frontend events after the PostHog migration live in PostHog.
-- The interactions/funnel queries retain compatibility with historical AE data.
-- name: errors
SELECT blob2 AS event, blob3 AS route, blob4 AS view, blob8 AS error_type,
       blob9 AS error_code, blob10 AS code_locations, blob12 AS server_release,
       blob13 AS client_release, SUM(double1 * double4 * _sample_interval) AS estimated_occurrences
FROM __DATASET__
WHERE timestamp >= NOW() - INTERVAL '__HOURS__' HOUR
  AND (blob6 = 'error' OR blob2 = 'client.error')
GROUP BY event, route, view, error_type, error_code, code_locations, server_release, client_release
ORDER BY estimated_occurrences DESC LIMIT 100

-- name: latency
SELECT blob3 AS route,
       SUM(double1 * double4 * _sample_interval) AS estimated_requests,
       SUM(IF(double3 >= 500, double1 * double4 * _sample_interval, 0)) / SUM(double1 * double4 * _sample_interval) AS estimated_5xx_rate,
       SUM(double2 * double4 * _sample_interval) / SUM(double1 * double4 * _sample_interval) AS average_ms,
       quantileExactWeighted(0.95)(double2, double4 * _sample_interval) AS p95_ms
FROM __DATASET__
WHERE timestamp >= NOW() - INTERVAL '__HOURS__' HOUR AND blob2 = 'api.request'
GROUP BY route ORDER BY p95_ms DESC LIMIT 100

-- name: funnel
SELECT blob2 AS stage, blob3 AS route, blob5 AS action, blob6 AS outcome,
       SUM(double1 * double4 * _sample_interval) AS estimated_attempts
FROM __DATASET__
WHERE timestamp >= NOW() - INTERVAL '__HOURS__' HOUR
  AND (blob2 = 'flow.step' OR blob2 = 'flow.result' OR (blob2 = 'api.request' AND blob14 != 'GET'))
GROUP BY stage, route, action, outcome ORDER BY stage, route, action, outcome LIMIT 500

-- name: interactions
SELECT blob4 AS view, blob5 AS control, blob2 AS event,
       SUM(double1 * double4 * _sample_interval) AS estimated_interactions
FROM __DATASET__
WHERE timestamp >= NOW() - INTERVAL '__HOURS__' HOUR AND startsWith(blob2, 'ui.')
GROUP BY view, control, event ORDER BY estimated_interactions DESC LIMIT 100

-- name: dependencies
SELECT blob3 AS route, blob15 AS dependency_failure,
       SUM(double5 * double4 * _sample_interval) AS estimated_d1_calls,
       SUM(double9 * double4 * _sample_interval) AS estimated_d1_metadata_results,
       SUM(double7 * double4 * _sample_interval) AS estimated_observed_rows_read,
       SUM(double8 * double4 * _sample_interval) AS estimated_observed_rows_written,
       SUM(double10 * double4 * _sample_interval) AS estimated_d1_failures,
       SUM(double13 * double4 * _sample_interval) AS estimated_r2_failures,
       SUM(double16 * double4 * _sample_interval) AS estimated_upstream_failures,
       SUM(double6 * double4 * _sample_interval) AS estimated_d1_ms,
       SUM(double12 * double4 * _sample_interval) AS estimated_r2_ms,
       SUM(double15 * double4 * _sample_interval) AS estimated_upstream_ms
FROM __DATASET__
WHERE timestamp >= NOW() - INTERVAL '__HOURS__' HOUR AND blob2 = 'api.request'
GROUP BY route, dependency_failure ORDER BY estimated_observed_rows_read DESC LIMIT 100

-- name: volume
SELECT toDate(timestamp) AS utc_date, blob2 AS event,
       SUM(_sample_interval) AS estimated_points_written,
       SUM(double1 * _sample_interval) AS observed_events_before_platform_sampling,
       SUM(double1 * double4 * _sample_interval) AS estimated_events_before_application_sampling
FROM __DATASET__
WHERE timestamp >= NOW() - INTERVAL '__HOURS__' HOUR
GROUP BY utc_date, event ORDER BY utc_date DESC, event LIMIT 500
