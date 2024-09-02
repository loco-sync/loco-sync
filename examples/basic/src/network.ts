import { createFakeNetworkAdapter } from './fake-network';
import { v4 } from 'uuid';
import { faker } from '@faker-js/faker';
import { MS } from './App';

export const network = createFakeNetworkAdapter<MS>({
  seedData: [
    {
      count: 1,
      fn: () => ({
        Hobby: [
          'Reading',
          'Music',
          'Astronomy',
          'Basket Weaving',
          'Hiking',
          'Biking',
          'Running',
          'Swimming',
          'Cooking',
          'Gardening',
          'Painting',
          'Sculpting',
          'Woodworking',
          'Metalworking',
          'Pottery',
        ].map((name) => ({
          id: v4(),
          name,
        })),
      }),
    },
    {
      count: 1000,
      fn: (store) => {
        const allHobbies = Array.from(store.get('Hobby')?.values() ?? []);
        const randomHobbies = allHobbies
          .sort(() => Math.random() - 0.5)
          .slice(0, Math.floor(Math.random() * 4));
        const personId = v4();

        return {
          Person: [
            {
              id: personId,
              name: faker.person.fullName(),
            },
          ],
          Pet: Array.from({ length: Math.floor(Math.random() * 3) }, () => {
            const type = faker.animal.type() as keyof typeof faker.animal;
            return {
              id: v4(),
              type,
              breed: faker.animal[type](),
              ownerId: personId,
            };
          }),
          PersonHobby: randomHobbies.map((hobby) => ({
            id: v4(),
            personId,
            hobbyId: hobby.id,
          })),
        };
      },
    },
  ],
});
