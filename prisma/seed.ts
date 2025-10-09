import { prisma } from '#app/utils/db.server.ts'
import {
	createPassword,
	createUser,
	getUserImages,
} from '#tests/db-utils.ts'

async function seed() {
	console.log('🌱 Seeding...')
	console.time(`🌱 Database has been seeded`)

	// Seed Services first (required for other entities)
	console.time(`🎵 Seeded services`)
	await prisma.service.upsert({
		where: { id: 'clnf2zvli0000pcou3zzzzome' },
		update: {},
		create: {
			id: 'clnf2zvli0000pcou3zzzzome',
			name: 'youtube',
			displayName: 'YouTube',
			baseUrl: 'https://youtube.com',
			logoUrl: '/logos/youtube.svg',
			isActive: true,
		},
	})
	console.timeEnd(`🎵 Seeded services`)

	const totalUsers = 5
	console.time(`👤 Created ${totalUsers} users...`)
	const userImages = await getUserImages()

	for (let index = 0; index < totalUsers; index++) {
		const userData = createUser()
		const user = await prisma.user.create({
			select: { id: true },
			data: {
				...userData,
				password: { create: createPassword(userData.username) },
				roles: { connect: { name: 'user' } },
			},
		})

		// Upload user profile image
		const userImage = userImages[index % userImages.length]
		if (userImage) {
			await prisma.userImage.create({
				data: {
					userId: user.id,
					objectKey: userImage.objectKey,
				},
			})
		}

	}
	console.timeEnd(`👤 Created ${totalUsers} users...`)

	console.time(`🐨 Created admin user "kody"`)

	const kodyImages = {
		kodyUser: { objectKey: 'user/kody.png' },
	}

	const kody = await prisma.user.upsert({
		where: { username: 'kody' },
		select: { id: true },
		update: {},
		create: {
			email: 'kody@kcd.dev',
			username: 'kody',
			name: 'Kody',
			password: { create: createPassword('kodylovesyou') },
			roles: { connect: [{ name: 'admin' }, { name: 'user' }] },
		},
	})

	await prisma.userImage.upsert({
		where: { userId: kody.id },
		update: {
			objectKey: kodyImages.kodyUser.objectKey,
		},
		create: {
			userId: kody.id,
			objectKey: kodyImages.kodyUser.objectKey,
		},
	})

	console.timeEnd(`🌱 Database has been seeded`)
}

seed()
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})

// we're ok to import from the test directory in this file
/*
eslint
	no-restricted-imports: "off",
*/
