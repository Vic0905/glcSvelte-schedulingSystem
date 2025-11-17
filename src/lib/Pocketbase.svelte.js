import PocketBase from 'pocketbase'

export const domain = 'http://172.168.15.38:8090'

export const pb = new PocketBase(domain)

pb.autoCancellation(false)

export const current = $state({
  user: pb.authStore.record,
})

pb.authStore.onChange(() => {
  current.user = pb.authStore.record
})
