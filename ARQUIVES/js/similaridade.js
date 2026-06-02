const rmLetras = (txt) =>
  txt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const getdistance = (a, b) => {
  const lenA = a.length, lenB = b.length
  if (!lenA) return lenB
  if (!lenB) return lenA

  const matrix = Array.from({ length: lenB + 1 }, (_, i) => [i])
  for (let j = 1; j <= lenA; j++) matrix[0][j] = j

  for (let i = 1; i <= lenB; i++) {
    for (let j = 1; j <= lenA; j++) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1
    }
  }
  return matrix[lenB][lenA]
}

const getSimilarity = (array, txt, prefix) => {
  let melhorNome = `${prefix}ᴍᴇɴᴜ`, melhorScore = 0
  const base = rmLetras(txt)

  for (const word of array) {
    const distance = getdistance(base, word.toLowerCase())
    const maxLen = Math.max(base.length, word.length)
    const score = 1 - distance / maxLen
    if (score > melhorScore) {
      melhorScore = score
      melhorNome = word
    }
  }

  return {
    nome: melhorNome,
    porcentagem: melhorScore * 100
  }
}

module.exports = getSimilarity
