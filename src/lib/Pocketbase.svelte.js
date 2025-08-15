import PocketBase from 'pocketbase'

export const domain = 'http://172.168.1.181:8090'

export const pb = new PocketBase(domain)

pb.autoCancellation(false)

export const current = $state({
  user: pb.authStore.record,
})

pb.authStore.onChange(() => {
  current.user = pb.authStore.record
})
