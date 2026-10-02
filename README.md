# EstudaJá Pro: Academic Owl

PROMPT 01 — FUNDAÇÃO DO PROJETO

Create a complete web application called EstudaJá Pro with an owl as the brand icon. The app is a multidisciplinary academic management platform focused on health education, with AI-powered content generation. The primary color scheme should use a teal/blue gradient header consistent throughout the app, with colorful discipline cards and clean white content areas.

TECHNOLOGY STACK Use React with TypeScript, Supabase as the backend and database, Tailwind CSS for styling, and integrate OpenAI API for all AI assistant functionalities. The app must be fully responsive for mobile and desktop.

USER PROFILES AND AUTHENTICATION The app must have four distinct user profiles: Admin, Institution, Teacher, and Student. Each profile has its own dashboard and access permissions. Student access is done via enrollment number (matricula) as login credentials. Teachers and Institutions register with email and password. Admin is a superuser with access to all data.

DATABASE STRUCTURE — CORE ENTITIES

The central entity of the entire system is the Discipline. Every feature in the app — materials, activities, exercises, attendance, grades, and assessments — must be created within and belong to a specific Discipline. No feature exists independently of a Discipline.

Create the following database tables:

Users table with fields: id, name, email, enrollment_number, password_hash, profile_type (admin, institution, teacher, student), created_at, status.

Disciplines table with fields: id, teacher_id, institution_id, name, code, semester, year, syllabus_text, syllabus_file_url, status (active, archived), created_at. Each discipline belongs to one teacher and optionally to one institution.

Discipline_Students table linking students to disciplines with fields: id, discipline_id, student_id, enrolled_at, status.

DISCIPLINE CARD FUNCTIONS Every discipline card must display the discipline name, semester, year, student count, and a options menu with exactly four actions: Edit — allows updating all discipline settings; Copy to New Semester — duplicates the discipline structure including all materials, activity templates, exercise configurations, rubrics and cover page settings, but excludes all students, attendance records, grades and submission history; Archive — moves discipline to archived state, preserving all data and history, accessible via a separate archived view; Delete — permanently removes the discipline with a mandatory confirmation dialog that warns the user all data will be permanently lost and suggests archiving instead if the discipline has enrolled students or launched attendance records.

ADMIN PANEL Admin dashboard must show total counts of institutions, teachers, students and active disciplines. Admin can manage all users with filters by profile type and search by name, email or enrollment number. Admin can import student lists via CSV file containing enrollment number and student name columns. Admin can configure grade diary structure per discipline including number of assessments, names, weights and passing average. Admin can configure attendance rules per discipline including whether justified absences count as presence and the minimum attendance percentage required.

INSTITUTION PANEL Institution dashboard shows all teachers linked to the institution, all disciplines, and overall performance reports by class and discipline. Institution can manage teacher and student accounts, configure grade structures and attendance rules, and view all academic data within their scope.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://owl-learn-hub.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/964fdf5e-4160-44e0-8d98-8a046c2832cc).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
