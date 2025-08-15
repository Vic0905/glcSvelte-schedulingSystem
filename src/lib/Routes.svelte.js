import wrap from 'svelte-spa-router/wrap'

export const adminRoutes = {
  '/': wrap({
    asyncComponent: () => import('../routes/admin/Dashboard/Dashboard.svelte'),
  }),
  '/registration': wrap({
    asyncComponent: () => import('../routes/admin/Forms/Registration/Registration.svelte'),
  }),
  '*': wrap({
    asyncComponent: () => import('../routes/PageNotFound/PageNotFound.svelte'),
  }),
}

export const guestRoutes = {
  '/': wrap({
    asyncComponent: () => import('../routes/LandingPage/LandingPage.svelte'),
  }),
  '/login': wrap({
    asyncComponent: () => import('../routes/auth/Login.svelte'),
  }),
  '/dashboard': wrap({
    asyncComponent: () => import('../routes/LandingPage/LandingPage.svelte'),
  }),
  '/registration': wrap({
    asyncComponent: () => import('../routes/forms/Registration/Registration.svelte'),
  }),
  '/registration/group': wrap({
    asyncComponent: () => import('../routes/forms/Registration/Group/GroupRegistration.svelte'),
  }),
  '/registration/single': wrap({
    asyncComponent: () => import('../routes/forms/Registration/Single/SingleRegistration.svelte'),
  }),
  '/rules': wrap({
    asyncComponent: () => import('../routes/forms/Rules/Rules.svelte'),
  }),
  '/rules/welcome': wrap({
    asyncComponent: () => import('../routes/forms/Rules/Welcome/Welcome.svelte'),
  }),
  '/rules/regulation': wrap({
    asyncComponent: () => import('../routes/forms/Rules/Regulation/Regulation.svelte'),
  }),

  '/schedule/scheduleinput': wrap({
    asyncComponent: () => import('../routes/Schedule/scheduleInput.svelte'),
  }),
  '/schedule/schedulestudent': wrap({
    asyncComponent: () => import('../routes/Schedule/scheduleStudent.svelte'),
  }),
  '/input/teacher': wrap({
    asyncComponent: () => import('../routes/Input/Teacher.svelte'),
  }),
  '/input/subject': wrap({
    asyncComponent: () => import('../routes/Input/Subject.svelte'),
  }),
  '/input/room': wrap({
    asyncComponent: () => import('../routes/Input/Room.svelte'),
  }),
  '/input/student': wrap({
    asyncComponent: () => import('../routes/Input/Student.svelte'),
  }),
  '/input/teacherview': wrap({
    asyncComponent: () => import('../routes/Input/TeacherView.svelte'),
  }),
  '*': wrap({
    asyncComponent: () => import('../routes/PageNotFound/PageNotFound.svelte'),
  }),
}

export const studentRoutes = {
  '/': wrap({
    asyncComponent: () => import('../routes/LandingPage/LandingPage.svelte'),
  }),
  '/rules': wrap({
    asyncComponent: () => import('../routes/forms/Rules/Rules.svelte'),
  }),
  '/rules/welcome': wrap({
    asyncComponent: () => import('../routes/forms/Rules/Welcome/Welcome.svelte'),
  }),
  '/rules/regulation': wrap({
    asyncComponent: () => import('../routes/forms/Rules/Regulation/Regulation.svelte'),
  }),
  '/request': wrap({
    asyncComponent: () => import('../routes/forms/LessonForms/Request.svelte'),
  }),
  '/lessonforms/teacher': wrap({
    asyncComponent: () => import('../routes/forms/LessonForms/Teacher/TeacherForm.svelte'),
  }),
  '/lessonforms/special': wrap({
    asyncComponent: () => import('../routes/forms/LessonForms/Special/SpecialForm.svelte'),
  }),
  '/lessonforms/additional': wrap({
    asyncComponent: () => import('../routes/forms/LessonForms/Additional/AdditionalClassesForm.svelte'),
  }),
  '*': wrap({
    asyncComponent: () => import('../routes/PageNotFound/PageNotFound.svelte'),
  }),
}

export const teacherRoutes = {
  '/': wrap({
    asyncComponent: () => import('../routes/LandingPage/LandingPage.svelte'),
  }),
  '/rules': wrap({
    asyncComponent: () => import('../routes/forms/Rules/Rules.svelte'),
  }),
  '/rules/welcome': wrap({
    asyncComponent: () => import('../routes/forms/Rules/Welcome/Welcome.svelte'),
  }),
  '/rules/regulation': wrap({
    asyncComponent: () => import('../routes/forms/Rules/Regulation/Regulation.svelte'),
  }),
  '/request': wrap({
    asyncComponent: () => import('../routes/forms/LessonForms/Request.svelte'),
  }),
  '/lessonforms/teacher': wrap({
    asyncComponent: () => import('../routes/forms/LessonForms/Teacher/TeacherForm.svelte'),
  }),
  '/lessonforms/special': wrap({
    asyncComponent: () => import('../routes/forms/LessonForms/Special/SpecialForm.svelte'),
  }),
  '/lessonforms/additional': wrap({
    asyncComponent: () => import('../routes/forms/LessonForms/Additional/AdditionalClassesForm.svelte'),
  }),
  '/input/teacher': wrap({
    asyncComponent: () => import('../routes/Input/Teacher.svelte'),
  }),
  '/input/teacherview': wrap({
    asyncComponent: () => import('../routes/Input/TeacherView.svelte'),
  }),
  '*': wrap({
    asyncComponent: () => import('../routes/PageNotFound/PageNotFound.svelte'),
  }),
}
