export const booking = $state({
  id: '',
  data: {
    label: '',
    id: '',
    date: '',
    startDate: '', // added
    endDate: '', // added
    subject: {
      name: '',
      id: '',
    },
    teacher: {
      name: '',
      id: '',
    },
    student: {
      name: '',
      id: '',
    },
    room: {
      name: '',
      id: '',
    },
    timeslot: {
      id: '',
      start: '',
      end: '',
    },
  },
})

export const grid = $state({
  schedule: null,
})
