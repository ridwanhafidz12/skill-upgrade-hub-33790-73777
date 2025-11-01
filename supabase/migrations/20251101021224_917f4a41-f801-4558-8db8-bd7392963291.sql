-- Drop overly permissive policy that allows anyone to view all profiles
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
USING (auth.uid() = id);

-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles"
ON profiles FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Users can view profiles of course instructors (for published courses only)
CREATE POLICY "View instructor profiles"
ON profiles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM courses
    WHERE courses.instructor_id = profiles.id
    AND courses.status = 'published'
  )
);