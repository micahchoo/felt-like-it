ALTER TABLE map_collaborators
  ADD CONSTRAINT map_collaborators_role_check
  CHECK (role IN ('viewer', 'commenter', 'editor'));

ALTER TABLE shares
  ADD CONSTRAINT shares_access_level_check
  CHECK (access_level IN ('public', 'unlisted'));

ALTER TABLE layers
  ADD CONSTRAINT layers_type_check
  CHECK (type IN ('point', 'line', 'polygon', 'mixed'));
