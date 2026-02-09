import wrap from 'svelte-spa-router/wrap'

export const adminRoutes = {
  '/': wrap({
    asyncComponent: () => import('../routes/admin/Dashboard/Dashboard.svelte'),
  }),
  '/registration': wrap({
    asyncComponent: () => import('../routes/admin/Forms/Registration/Registration.svelte'),
  }),
  '/management/group': wrap({
    asyncComponent: () => import('../routes/admin/Management/Group.svelte'),
  }),
  '/management/room': wrap({
    asyncComponent: () => import('../routes/admin/Management/Room.svelte'),
  }),
  '/management/student': wrap({
    asyncComponent: () => import('../routes/admin/Management/Student.svelte'),
  }),
  '/management/subject': wrap({
    asyncComponent: () => import('../routes/admin/Management/Subject.svelte'),
  }),
  '/management/teacher': wrap({
    asyncComponent: () => import('../routes/admin/Management/Teacher.svelte'),
  }),
  '/management/bookings': wrap({
    asyncComponent: () => import('../routes/admin/Management/Bookings.svelte'),
  }),
  '/advance/advanceschedule': wrap({
    asyncComponent: () => import('../routes/admin/Advance/advanceSchedule.svelte'),
  }),
  '/advance/advancegroupschedule': wrap({
    asyncComponent: () => import('../routes/admin/Advance/advanceGroupSchedule.svelte'),
  }),
  '/advance/grouptemplate': wrap({
    asyncComponent: () => import('../routes/admin/Advance/GroupTemplate.svelte'),
  }),
  '/advance/studenttemplate': wrap({
    asyncComponent: () => import('../routes/admin/Advance/StudentTemplate.svelte'),
  }),
  '/advance/teachertemplate': wrap({
    asyncComponent: () => import('../routes/admin/Advance/TeacherTemplate.svelte'),
  }),
  '/current/scheduleinput': wrap({
    asyncComponent: () => import('../routes/admin/Current/scheduleInput.svelte'),
  }),
  '/current/grouptable': wrap({
    asyncComponent: () => import('../routes/admin/Current/GroupTable.svelte'),
  }),
  '/current/groupview': wrap({
    asyncComponent: () => import('../routes/admin/Current/GroupView.svelte'),
  }),
  '/current/studentview': wrap({
    asyncComponent: () => import('../routes/admin/Current/StudentView.svelte'),
  }),
  '/current/teacherview': wrap({
    asyncComponent: () => import('../routes/admin/Current/TeacherView.svelte'),
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
  '/schedule/advanceschedule': wrap({
    asyncComponent: () => import('../routes/Schedule/advanceSchedule.svelte'),
  }),
  '/schedule/scheduleinput': wrap({
    asyncComponent: () => import('../routes/Schedule/scheduleInput.svelte'),
  }),
  '/schedule/advancegroupschedule': wrap({
    asyncComponent: () => import('../routes/Schedule/advanceGroupSchedule.svelte'),
  }),
  '/schedule/grouptable': wrap({
    asyncComponent: () => import('../routes/Schedule/GroupTable.svelte'),
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
  '/input/group': wrap({
    asyncComponent: () => import('../routes/Input/Group.svelte'),
  }),
  '/input/student': wrap({
    asyncComponent: () => import('../routes/Input/Student.svelte'),
  }),
  '/input/teacherview': wrap({
    asyncComponent: () => import('../routes/Input/TeacherView.svelte'),
  }),
  '/input/studentview': wrap({
    asyncComponent: () => import('../routes/Input/StudentView.svelte'),
  }),
  '/input/studenttemplate': wrap({
    asyncComponent: () => import('../routes/Input/StudentTemplate.svelte'),
  }),
  '/input/teachertemplate': wrap({
    asyncComponent: () => import('../routes/Input/TeacherTemplate.svelte'),
  }),
  '/input/grouptemplate': wrap({
    asyncComponent: () => import('../routes/Input/GroupTemplate.svelte'),
  }),
  '/input/groupview': wrap({
    asyncComponent: () => import('../routes/Input/GroupView.svelte'),
  }),
  '/inventory/inventory': wrap({
    asyncComponent: () => import('../routes/Inventory/inventory.svelte'),
  }),
  '*': wrap({
    asyncComponent: () => import('../routes/PageNotFound/PageNotFound.svelte'),
  }),
}

export const staffRoutes = {
  '/': wrap({
    asyncComponent: () => import('../routes/admin/Dashboard/StaffDash.svelte'),
  }),
  '/advance/mondayadvanceschedule': wrap({
    asyncComponent: () => import('../routes/admin/Advance/MondayAdvanceSchedule.svelte'),
  }),
  '/advance/mondayadvancegroup': wrap({
    asyncComponent: () => import('../routes/admin/Advance/MondayAdvanceGroup.svelte'),
  }),
  '/advance/mondaygrouptemplate': wrap({
    asyncComponent: () => import('../routes/admin/Advance/MondayGroupTemplate.svelte'),
  }),
  '/advance/mondaystudentview': wrap({
    asyncComponent: () => import('../routes/admin/Advance/MondayStudentView.svelte'),
  }),
  '/advance/mondayteacherview': wrap({
    asyncComponent: () => import('../routes/admin/Advance/MondayTeacherView.svelte'),
  }),
  '/current/mondayscheduleinput': wrap({
    asyncComponent: () => import('../routes/admin/Current/MondayScheduleInput.svelte'),
  }),
  '/current/mondaygrouptable': wrap({
    asyncComponent: () => import('../routes/admin/Current/MondayGroupTable.svelte'),
  }),
  '/current/mondaystudentview': wrap({
    asyncComponent: () => import('../routes/admin/Current/MondayStudentView.svelte'),
  }),
  '/current/mondayteacherview': wrap({
    asyncComponent: () => import('../routes/admin/Current/MondayTeacherView.svelte'),
  }),
  '/current/mondaygroupview': wrap({
    asyncComponent: () => import('../routes/admin/Current/MondayGroupView.svelte'),
  }),
  '/inventory/inventory': wrap({
    asyncComponent: () => import('../routes/Inventory/inventory.svelte'),
  }),
  '*': wrap({
    asyncComponent: () => import('../routes/PageNotFound/PageNotFound.svelte'),
  }),
}

export const teacherRoutes = {
  '/': wrap({
    asyncComponent: () => import('../routes/admin/Dashboard/TeacherDash.svelte'),
  }),
  '/current/teacherview': wrap({
    asyncComponent: () => import('../routes/admin/Current/TeacherView.svelte'),
  }),
  '*': wrap({
    asyncComponent: () => import('../routes/PageNotFound/PageNotFound.svelte'),
  }),
}
