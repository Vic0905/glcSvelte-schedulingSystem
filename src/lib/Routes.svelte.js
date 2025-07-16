import wrap from 'svelte-spa-router/wrap'

export const adminRoutes = {
  '/': wrap({
    asyncComponent: () => import('../routes/admin/Dashboard/Dashboard.svelte'),
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
  '*': wrap({
    asyncComponent: () => import('../routes/PageNotFound/PageNotFound.svelte'),
  }),
}

export const studentRoutes = {}
