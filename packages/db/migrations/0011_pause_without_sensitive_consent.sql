-- Members who joined before the explicit consent for sensitive data existed are hidden from discovery
-- until they give it (the app asks on their next visit; consenting sets them back to active).
UPDATE "user" u SET status = 'paused'
WHERE u.status = 'active' AND u.role = 'user'
  AND NOT EXISTS (
    SELECT 1 FROM consents c
    WHERE c.user_id = u.id AND c.kind = 'sensitive' AND c.granted
  );
