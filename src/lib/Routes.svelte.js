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
  '/registration': wrap({
    asyncComponent: () => import('../routes/Registration/Registration.svelte'),
  }),
  '/registration/group': wrap({
    asyncComponent: () => import('../routes/Registration/Group/GroupRegistration.svelte'),
  }),
  '/registration/single': wrap({
    asyncComponent: () => import('../routes/Registration/Single/SingleRegistration.svelte'),
  }),
  '*': wrap({
    asyncComponent: () => import('../routes/PageNotFound/PageNotFound.svelte'),
  }),
}

export const studentRoutes = {}
