import { GraphQLFieldConfig, GraphQLNonNull, GraphQLID } from 'graphql'
import { Collection, CollectionKey, ObjectType } from '../../../interface'
import { formatName, idSerde, buildObject, scrib } from '../../utils'
import BuildToken from '../BuildToken'
import createConnectionGqlField from '../connection/createConnectionGqlField'
import getCollectionGqlType from './getCollectionGqlType'
import createCollectionKeyInputHelpers from './createCollectionKeyInputHelpers'
import getConditionGqlType from './getConditionGqlType'

/**
 * Creates any number of query field entries for a collection. These fields
 * will be on the root query type.
 */
export default function createCollectionQueryFieldEntries (
  buildToken: BuildToken,
  collection: Collection,
): Array<[string, GraphQLFieldConfig<mixed, mixed>]> {
  const type = collection.type
  const entries: Array<[string, GraphQLFieldConfig<mixed, mixed>]> = []
  const primaryKey = collection.primaryKey
  const paginator = collection.paginator

  // If the collection has a paginator, let’s use it to create a connection
  // field for our collection.
  if (paginator) {
    const { gqlType: gqlConditionType, fromGqlInput: conditionFromGqlInput } = getConditionGqlType(buildToken, type)
    entries.push([
      formatName.field(`all-${collection.name}`),
      createConnectionGqlField(buildToken, paginator, {
        // The one input arg we have for this connection is the `condition` arg.
        inputArgEntries: [
          ['condition', {
            description: 'A condition to be used in determining which values should be returned by the collection.',
            type: gqlConditionType,
          }],
        ],
        getPaginatorInput: (headValue: mixed, args: { condition?: { [key: string]: mixed } }) =>
          conditionFromGqlInput(args.condition),
      }),
    ])

  }

  // Add a field to select our collection by its primary key, if the
  // collection has a primary key. Note that we abstract away the shape of
  // the primary key in this instance. Instead using a GraphQL native format,
  // the id format.
  if (primaryKey) {
    const field = createCollectionPrimaryKeyField(buildToken, primaryKey)

    // If we got a field back, add it.
    if (field)
      entries.push([formatName.field(type.name), field])
  }

  // Add a field to select any value in the collection by any key. So all
  // unique keys of an object will be usable to select a single value.
  for (const collectionKey of (collection.keys || [])) {
    const field = createCollectionKeyField(buildToken, collectionKey)

    // If we got a field back, add it.
    if (field) entries.push([formatName.field(`${type.name}-by-${collectionKey.name}`), field])
  }

  return entries
}

/**
 * Creates the field used to select an object by its primary key using a
 * GraphQL global id.
 */
function createCollectionPrimaryKeyField <TKey>(
  buildToken: BuildToken,
  collectionKey: CollectionKey<TKey>,
): GraphQLFieldConfig<mixed, mixed> | undefined {
  const { options, inventory } = buildToken
  const { collection, keyType } = collectionKey

  // If we can’t read from this collection key, stop.
  if (collectionKey.read == null)
    return

  const collectionType = getCollectionGqlType(buildToken, collection)

  return {
    description: `Reads a single ${scrib.type(collectionType)} using its globally unique ${scrib.type(GraphQLID)}.`,
    type: collectionType,

    args: {
      [options.nodeIdFieldName]: {
        description: `The globally unique ${scrib.type(GraphQLID)} to be used in selecting a single ${scrib.type(collectionType)}.`,
        type: new GraphQLNonNull(GraphQLID),
      },
    },

    async resolve (source, args, context): Promise<ObjectType.Value | null> {
      const result = idSerde.deserialize(inventory, args[options.nodeIdFieldName] as string)

      if (result.collection !== collection)
        throw new Error(`The provided id is for collection '${result.collection.name}', not the expected collection '${collection.name}'.`)

      if (!keyType.isTypeOf(result.keyValue))
        throw new Error(`The provided id is not of the correct type.`)

      return await collectionKey.read!(context, result.keyValue)
    },
  }
}

/**
 * Creates a field using the value from any collection key.
 */
// TODO: test
function createCollectionKeyField <TKey>(
  buildToken: BuildToken,
  collectionKey: CollectionKey<TKey>,
): GraphQLFieldConfig<mixed, mixed> | undefined {
  // If we can’t read from this collection key, stop.
  if (collectionKey.read == null)
    return

  const { collection } = collectionKey
  const collectionType = getCollectionGqlType(buildToken, collection)
  const inputHelpers = createCollectionKeyInputHelpers<TKey>(buildToken, collectionKey)

  return {
    type: collectionType,
    args: buildObject(inputHelpers.fieldEntries),
    async resolve (source, args, context): Promise<ObjectType.Value | null> {
      const key = inputHelpers.getKey(args)
      return await collectionKey.read!(context, key)
    },
  }
}
