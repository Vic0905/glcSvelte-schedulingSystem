<script>
  import { Grid, h } from 'gridjs'
  import { domain, pb } from '../../../../lib/Pocketbase.svelte'
  import { onDestroy } from 'svelte'
  import { toast } from 'svelte-sonner'

  let data = $state({})

  let registrationTable

  let gridColumns = [
    {
      name: 'ID',
      id: 'id',
      hidden: true,
    },
    {
      name: 'First Name',
      id: 'firstName',
    },
    {
      name: 'Last Name',
      id: 'lastName',
    },
    {
      name: 'Nationality',
      id: 'nationality',
    },
    {
      name: 'Created',
      id: 'created',
      formatter: (cell) => `${new Date(cell).toLocaleDateString()}`,
    },
    {
      name: 'Actions',
      columns: [
        {
          name: 'View',
          sort: false,
          formatter: (cell, row) => {
            return h(
              'button',
              {
                className: 'btn btn-xs btn-warning',
                onClick: async () => {
                  toast.promise(pb.collection('users').getOne(row.cells[0].data), {
                    loading: 'Fetching User Data ...',
                    success: (userData) => {
                      if (userData) {
                        Object.assign(data, userData)

                        studentModal.showModal()
                      }
                      return 'Fetch success!'
                    },
                    error: (error) => {
                      return `Error: ${error.message}`
                    },
                  })
                },
              },
              'View'
            )
          },
        },
        {
          name: 'Delete',
          sort: false,
          formatter: (cell, row) => {
            return h(
              'button',
              {
                className: 'btn btn-xs btn-error',
                onClick: () => {
                  if (window.confirm(`Are you sure you want to delete ${row.cells[1].data} ${row.cells[1].data}?`)) {
                    toast.promise(pb.collection('users').delete(row.cells[0].data), {
                      loading: 'Deleting...',
                      success: () => {
                        registrationTable.updateConfig({}).forceRender()
                        return 'Deletion Success!'
                      },
                      error: (error) => {
                        return `Error: ${error.message}`
                      },
                    })
                  }
                },
              },
              'Delete'
            )
          },
        },
      ],
    },
  ]

  const createTable = async (node) => {
    registrationTable = new Grid({
      sort: {
        multiColumn: false,
        server: {
          url: (prev, columns) => {
            if (!columns.length) return prev

            const col = columns[0]
            const colName = gridColumns[col.index]?.id || gridColumns[col.index]?.name
            const dir = col.direction === 1 ? '-' : ''

            return `${prev}sort=${dir}${colName}&`
          },
        },
      },
      columns: gridColumns,
      pagination: {
        limit: 10,
        server: {
          url: (prev, page, limit) => `${prev}page=${page + 1}&perPage=${limit}`,
        },
      },
      search: {
        server: {
          url: (prev, keyword) =>
            `${prev}filter=(firstName ~ '${keyword}' || lastName ~ '${keyword}' || nationality ~ '${keyword}')&`,
        },
      },
      server: {
        url: `${domain}/api/collections/users/records?`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${pb.authStore.token}`,
          'Content-Type': 'application/json',
        },
        then: (data) => data.items,
        total: (data) => data.totalItems,
      },
      className: {
        table: 'text-xs',
        pagination: 'text-xs',
        tr: 'text-center',
      },
      autoWidth: true,
    }).render(node)
  }

  const updateStudent = async (e) => {
    e.preventDefault()
    toast.promise(pb.collection('users').update(data.id, data), {
      loading: 'Updating...',
      success: (data) => {
        if (data) {
          studentModal.close()
          registrationTable.updateConfig({}).forceRender()
        }
        return 'Update Success'
      },
      error: (error) => {
        return `Error: ${JSON.parse(error.data)}`
      },
    })
  }

  onDestroy(() => {
    registrationTable.destroy()
  })
</script>

<div class="m-5">
  <p class="text-3xl">Registration</p>
  <br />
  <div use:createTable></div>
</div>

<dialog id="studentModal" class="modal">
  <div class="modal-box max-w-2xl">
    <form method="dialog">
      <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">✕</button>
    </form>
    <h3 class="text-lg font-bold">Student</h3>
    <form class="font-[inter] m-2 max-w-xl mx-auto" onsubmit={updateStudent}>
      <fieldset class="fieldset bg-base-200 border-base-300 rounded-box border p-4">
        <legend class="fieldset-legend">Registration</legend>

        <div class="flex flex-wrap justify-evenly gap-2">
          <div class="col-1">
            <fieldset class="fieldset">
              <legend class="fieldset-legend">First Name</legend>
              <input type="text" class="input" bind:value={data.firstName} required />
              <p class="label">e.g John</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Nick Name</legend>
              <input type="text" class="input" bind:value={data.nickName} required />
              <p class="label">e.g Doedoe</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Gender</legend>
              <select class="select" bind:value={data.gender} required>
                <option value="male" class="option">Male</option>
                <option value="female" class="option">Female</option>
              </select>
              <p class="label">e.g Male or Female</p>
            </fieldset>

            <fieldset class="fieldset">
              <legend class="fieldset-legend">Nationality</legend>
              <select class="select" bind:value={data.nationality}>
                <option value="JP" class="option">JP</option>
                <option value="CH" class="option">CH</option>
                <option value="TH" class="option">TH</option>
                <option value="KR" class="option">KR</option>
                <option value="RU" class="option">RU</option>
                <option value="VN" class="option">VN</option>
                <option value="ARB" class="option">ARB</option>
                <option value="MNG" class="option">MNG</option>
                <option value="TW" class="option">TW</option>
              </select>
              <p class="label">e.g Japanese, Thai</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Height</legend>
              <input type="text" class="input" bind:value={data.height} required />
              <p class="label">height (cm)</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Home Address</legend>
              <input type="text" class="input" bind:value={data.homeAddress} required />
              <p class="label">e.g No. 111, ABC street, ABC ward</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Country</legend>
              <input type="text" class="input" bind:value={data.country} required />
              <p class="label">e.g Japan</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Email</legend>
              <input type="text" class="input" bind:value={data.email} disabled />
              <p class="label">e.g example@gmail.com</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Passport Number</legend>
              <input type="text" class="input" bind:value={data.passportNumber} required />
              <p class="label">e.g A*******</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Emergency 1</legend>
              <input type="text" class="input" bind:value={data.emergency1} required />
              <p class="label">e.g john Doe +09******</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Your School/Company (optional)</legend>
              <input type="text" class="input" bind:value={data.schoolOrCompany} required />
              <p class="label">e.g ABC college, ABC company</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Blood Type</legend>
              <select name="blood_type" class="select" bind:value={data.bloodType}>
                <option disabled selected>Select blood type</option>
                <option value="A" class="option">A</option>
                <option value="B" class="option">B</option>
                <option value="O" class="option">O</option>
                <option value="AB" class="option">AB</option>
                <option value="不明" class="option">不明</option>
              </select>
              <p class="label">e.g A, B, O, AB, 不明</p>
            </fieldset>
          </div>

          <div class="col-2">
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Last Name</legend>
              <input type="text" class="input" bind:value={data.lastName} required />
              <p class="label">e.g Doe</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Middle Name</legend>
              <input type="text" class="input" bind:value={data.middleName} required />
              <p class="label">e.g Doe</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Age</legend>
              <input type="number" class="input" bind:value={data.age} required />
              <p class="label">e.g 12, 20, 25</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Date of Birth</legend>
              <input type="date" class="input" bind:value={data.dob} required />
              <p class="label">input your birth date</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Weight</legend>
              <input type="text" class="input" bind:value={data.weight} required />
              <p class="label">weight (kg)</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Civil Status</legend>
              <select class="select" bind:value={data.civilStatus}>
                <option value="single" class="option">Single</option>
                <option value="married" class="option">Married</option>
              </select>
              <p class="label">e.g single or married</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Zip Code</legend>
              <input type="text" class="input" bind:value={data.zipCode} required />
              <p class="label">e.g 123-4567</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">City</legend>
              <input type="text" class="input" bind:value={data.city} required />
              <p class="label">e.g Tokyo</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Mobile Number in Philippines</legend>
              <input type="text" class="input" bind:value={data.phone} required />
              <p class="label">e.g 09*********</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Emergency 2</legend>
              <input type="text" class="input" bind:value={data.emergency2} required />
              <p class="label">e.g Sam Smith +09******</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Occupation/Profession</legend>
              <input type="text" class="input" bind:value={data.occupation} required />
              <p class="text-wrap max-w-[200px]">e.g. student, office worker, etc</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">SNS Permission</legend>
              <input type="checkbox" bind:checked={data.snsPermission} class="checkbox" />
              <p class="text-wrap max-w-[200px]">
                Do you permit GLC to post photos/videos that you are appeared on our social media accounts? * If it is
                "No",we will put mosaic or sticker on your face.
              </p>
            </fieldset>
          </div>
        </div>

        <div class="flex justify-end m-2">
          <button type="submit" class="btn btn-info">Update</button>
        </div>
      </fieldset>
    </form>
  </div>
</dialog>

<style global>
  @import 'https://cdn.jsdelivr.net/npm/gridjs/dist/theme/mermaid.min.css';
</style>
