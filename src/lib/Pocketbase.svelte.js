import PocketBase from 'pocketbase'

export const domain = 'https://glc-forms.lemon-live.space'

export const pb = new PocketBase(domain)

pb.autoCancellation(false)

export const current = $state({
  user: pb.authStore.record,
})

pb.authStore.onChange(() => {
  current.user = pb.authStore.record
})
