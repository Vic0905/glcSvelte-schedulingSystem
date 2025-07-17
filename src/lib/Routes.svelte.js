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
  '*': wrap({
    asyncComponent: () => import('../routes/PageNotFound/PageNotFound.svelte'),
  }),
}

export const studentRoutes = {}
