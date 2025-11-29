// @context7: React, Form Components
import { useState } from 'react'
import { Field } from '#app/components/forms'
import { Button } from '#app/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card'
import { Checkbox } from '#app/components/ui/checkbox'
import { Icon } from '#app/components/ui/icon'
import { Label } from '#app/components/ui/label'
import { Textarea } from '#app/components/ui/textarea'

export type FileMetadata = {
	title?: string
	artist?: string
	album?: string
	genre?: string
	year?: number
	trackNumber?: number
	albumArtist?: string
	bpm?: number
	label?: string
	isrc?: string
	originalDate?: string
	originalYear?: number
	releaseDate?: string
	totalTracks?: number
	totalDiscs?: number
	lyrics?: string
}

interface MetadataEditorProps {
	files: Array<{
		fileName: string
		extractedMetadata: FileMetadata | null
		editedMetadata: FileMetadata
		error?: string
	}>
	onUpdate: (index: number, updates: Partial<FileMetadata>) => void
	onBulkUpdate?: (updates: Partial<FileMetadata>) => void
	onConfirm: () => void
	onCancel: () => void
}

export function MetadataEditor({
	files,
	onUpdate,
	onBulkUpdate: _onBulkUpdate,
	onConfirm,
	onCancel,
}: MetadataEditorProps) {
	const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
	const [showAdvanced, setShowAdvanced] = useState(false)
	const [bulkEditMode, setBulkEditMode] = useState(false)
	const [bulkMetadata, setBulkMetadata] = useState<Partial<FileMetadata>>({})

	const toggleSelection = (index: number) => {
		setSelectedIndices(prev => {
			const next = new Set(prev)
			if (next.has(index)) {
				next.delete(index)
			} else {
				next.add(index)
			}
			return next
		})
	}

	const selectAll = () => {
		setSelectedIndices(new Set(files.map((_, i) => i)))
	}

	const deselectAll = () => {
		setSelectedIndices(new Set())
	}

	const applyBulkEdit = () => {
		if (selectedIndices.size === 0) return
		
		selectedIndices.forEach(index => {
			onUpdate(index, bulkMetadata)
		})
		
		setBulkEditMode(false)
		setBulkMetadata({})
		setSelectedIndices(new Set())
	}
	

	const validateFiles = () => {
		return files.every(file => 
			file.editedMetadata.title && file.editedMetadata.artist
		)
	}

	const canProceed = validateFiles()

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Edit Metadata</CardTitle>
							<CardDescription>
								Review and edit metadata for each file. Select multiple files to apply bulk edits.
							</CardDescription>
						</div>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowAdvanced(!showAdvanced)}
							>
								<Icon name={showAdvanced ? "chevron-up" : "chevron-down"} className="mr-2" />
								{showAdvanced ? 'Hide' : 'Show'} Advanced
							</Button>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{/* Bulk Edit Controls */}
					{selectedIndices.size > 0 && (
						<div className="mb-6 p-4 bg-muted rounded-lg">
							<div className="flex items-center justify-between mb-4">
								<p className="text-sm font-medium">
									{selectedIndices.size} file(s) selected
								</p>
								<div className="flex gap-2">
									<Button
										variant="outline"
										size="sm"
										onClick={() => {
											setBulkEditMode(true)
											// Pre-fill with common values from selected files
											const firstSelectedIndex = Array.from(selectedIndices)[0]
											const firstSelected = firstSelectedIndex !== undefined ? files[firstSelectedIndex] : undefined
											if (firstSelected) {
												setBulkMetadata({
													album: firstSelected.editedMetadata.album || undefined,
													albumArtist: firstSelected.editedMetadata.albumArtist || undefined,
													genre: firstSelected.editedMetadata.genre || undefined,
													year: firstSelected.editedMetadata.year || undefined,
												})
											}
										}}
									>
										<Icon name="pencil-1" className="mr-2" />
										Bulk Edit
									</Button>
									<Button
										variant="outline"
										size="sm"
										onClick={deselectAll}
									>
										Deselect All
									</Button>
								</div>
							</div>
							{bulkEditMode && (
								<div className="space-y-4 p-4 bg-background rounded border">
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
										<Field
											labelProps={{ htmlFor: 'bulk-album', children: 'Album' }}
											inputProps={{
												id: 'bulk-album',
												type: 'text',
												value: bulkMetadata.album || '',
												onChange: (e) => setBulkMetadata({ ...bulkMetadata, album: e.target.value }),
											}}
											errors={[]}
										/>
										<Field
											labelProps={{ htmlFor: 'bulk-album-artist', children: 'Album Artist' }}
											inputProps={{
												id: 'bulk-album-artist',
												type: 'text',
												value: bulkMetadata.albumArtist || '',
												onChange: (e) => setBulkMetadata({ ...bulkMetadata, albumArtist: e.target.value }),
											}}
											errors={[]}
										/>
										<Field
											labelProps={{ htmlFor: 'bulk-genre', children: 'Genre' }}
											inputProps={{
												id: 'bulk-genre',
												type: 'text',
												value: bulkMetadata.genre || '',
												onChange: (e) => setBulkMetadata({ ...bulkMetadata, genre: e.target.value }),
											}}
											errors={[]}
										/>
										<Field
											labelProps={{ htmlFor: 'bulk-year', children: 'Year' }}
											inputProps={{
												id: 'bulk-year',
												type: 'number',
												value: bulkMetadata.year || '',
												onChange: (e) => setBulkMetadata({ ...bulkMetadata, year: e.target.value ? parseInt(e.target.value) : undefined }),
											}}
											errors={[]}
										/>
									</div>
									<div className="flex gap-2">
										<Button size="sm" onClick={applyBulkEdit}>
											Apply to Selected
										</Button>
										<Button size="sm" variant="outline" onClick={() => {
											setBulkEditMode(false)
											setBulkMetadata({})
										}}>
											Cancel
										</Button>
									</div>
								</div>
							)}
						</div>
					)}

					{/* Selection Controls */}
					<div className="mb-4 flex gap-2">
						<Button variant="outline" size="sm" onClick={selectAll}>
							Select All
						</Button>
						<Button variant="outline" size="sm" onClick={deselectAll}>
							Deselect All
						</Button>
					</div>

					{/* Files List */}
					<div className="space-y-4 max-h-[600px] overflow-y-auto">
						{files.map((file, index) => (
							<Card key={index} className={selectedIndices.has(index) ? 'border-primary' : ''}>
								<CardContent className="pt-6">
									<div className="flex items-start gap-4">
										<Checkbox
											checked={selectedIndices.has(index)}
											onCheckedChange={() => toggleSelection(index)}
										/>
										<div className="flex-1 space-y-4">
											<div>
												<p className="font-medium text-sm text-muted-foreground mb-1">
													{file.fileName}
												</p>
												{file.error && (
													<p className="text-xs text-destructive">{file.error}</p>
												)}
											</div>

											{/* Required Fields */}
											<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
												<Field
													labelProps={{ htmlFor: `title-${index}`, children: 'Title *' }}
													inputProps={{
														id: `title-${index}`,
														type: 'text',
														value: file.editedMetadata.title || '',
														onChange: (e) => onUpdate(index, { title: e.target.value }),
														required: true,
													}}
													errors={[]}
												/>
												<Field
													labelProps={{ htmlFor: `artist-${index}`, children: 'Artist *' }}
													inputProps={{
														id: `artist-${index}`,
														type: 'text',
														value: file.editedMetadata.artist || '',
														onChange: (e) => onUpdate(index, { artist: e.target.value }),
														required: true,
													}}
													errors={[]}
												/>
											</div>

											{/* Basic Fields */}
											<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
												<Field
													labelProps={{ htmlFor: `album-${index}`, children: 'Album' }}
													inputProps={{
														id: `album-${index}`,
														type: 'text',
														value: file.editedMetadata.album || '',
														onChange: (e) => onUpdate(index, { album: e.target.value }),
													}}
													errors={[]}
												/>
												<Field
													labelProps={{ htmlFor: `genre-${index}`, children: 'Genre' }}
													inputProps={{
														id: `genre-${index}`,
														type: 'text',
														value: file.editedMetadata.genre || '',
														onChange: (e) => onUpdate(index, { genre: e.target.value }),
													}}
													errors={[]}
												/>
												<Field
													labelProps={{ htmlFor: `year-${index}`, children: 'Year' }}
													inputProps={{
														id: `year-${index}`,
														type: 'number',
														value: file.editedMetadata.year || '',
														onChange: (e) => onUpdate(index, { year: e.target.value ? parseInt(e.target.value) : undefined }),
													}}
													errors={[]}
												/>
												<Field
													labelProps={{ htmlFor: `track-number-${index}`, children: 'Track Number' }}
													inputProps={{
														id: `track-number-${index}`,
														type: 'number',
														value: file.editedMetadata.trackNumber || '',
														onChange: (e) => onUpdate(index, { trackNumber: e.target.value ? parseInt(e.target.value) : undefined }),
													}}
													errors={[]}
												/>
												<Field
													labelProps={{ htmlFor: `album-artist-${index}`, children: 'Album Artist' }}
													inputProps={{
														id: `album-artist-${index}`,
														type: 'text',
														value: file.editedMetadata.albumArtist || '',
														onChange: (e) => onUpdate(index, { albumArtist: e.target.value }),
													}}
													errors={[]}
												/>
											</div>

											{/* Advanced Fields */}
											{showAdvanced && (
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
													<Field
														labelProps={{ htmlFor: `bpm-${index}`, children: 'BPM' }}
														inputProps={{
															id: `bpm-${index}`,
															type: 'number',
															value: file.editedMetadata.bpm || '',
															onChange: (e) => onUpdate(index, { bpm: e.target.value ? parseInt(e.target.value) : undefined }),
														}}
														errors={[]}
													/>
													<Field
														labelProps={{ htmlFor: `label-${index}`, children: 'Label' }}
														inputProps={{
															id: `label-${index}`,
															type: 'text',
															value: file.editedMetadata.label || '',
															onChange: (e) => onUpdate(index, { label: e.target.value }),
														}}
														errors={[]}
													/>
													<Field
														labelProps={{ htmlFor: `isrc-${index}`, children: 'ISRC' }}
														inputProps={{
															id: `isrc-${index}`,
															type: 'text',
															value: file.editedMetadata.isrc || '',
															onChange: (e) => onUpdate(index, { isrc: e.target.value }),
														}}
														errors={[]}
													/>
													<Field
														labelProps={{ htmlFor: `original-year-${index}`, children: 'Original Year' }}
														inputProps={{
															id: `original-year-${index}`,
															type: 'number',
															value: file.editedMetadata.originalYear || '',
															onChange: (e) => onUpdate(index, { originalYear: e.target.value ? parseInt(e.target.value) : undefined }),
														}}
														errors={[]}
													/>
													<Field
														labelProps={{ htmlFor: `total-tracks-${index}`, children: 'Total Tracks' }}
														inputProps={{
															id: `total-tracks-${index}`,
															type: 'number',
															value: file.editedMetadata.totalTracks || '',
															onChange: (e) => onUpdate(index, { totalTracks: e.target.value ? parseInt(e.target.value) : undefined }),
														}}
														errors={[]}
													/>
													<Field
														labelProps={{ htmlFor: `total-discs-${index}`, children: 'Total Discs' }}
														inputProps={{
															id: `total-discs-${index}`,
															type: 'number',
															value: file.editedMetadata.totalDiscs || '',
															onChange: (e) => onUpdate(index, { totalDiscs: e.target.value ? parseInt(e.target.value) : undefined }),
														}}
														errors={[]}
													/>
													<Field
														labelProps={{ htmlFor: `release-date-${index}`, children: 'Release Date' }}
														inputProps={{
															id: `release-date-${index}`,
															type: 'date',
															value: file.editedMetadata.releaseDate || '',
															onChange: (e) => onUpdate(index, { releaseDate: e.target.value }),
														}}
														errors={[]}
													/>
													<Field
														labelProps={{ htmlFor: `original-date-${index}`, children: 'Original Date' }}
														inputProps={{
															id: `original-date-${index}`,
															type: 'date',
															value: file.editedMetadata.originalDate || '',
															onChange: (e) => onUpdate(index, { originalDate: e.target.value }),
														}}
														errors={[]}
													/>
													<div className="md:col-span-2">
														<Label htmlFor={`lyrics-${index}`}>Lyrics</Label>
														<Textarea
															id={`lyrics-${index}`}
															value={file.editedMetadata.lyrics || ''}
															onChange={(e) => onUpdate(index, { lyrics: e.target.value })}
															rows={4}
															className="mt-1"
														/>
													</div>
												</div>
											)}
										</div>
									</div>
								</CardContent>
							</Card>
						))}
					</div>

					{/* Action Buttons */}
					<div className="flex gap-4 pt-4 border-t">
						<Button
							onClick={onConfirm}
							disabled={!canProceed}
						>
							Continue to Confirmation
						</Button>
						<Button variant="outline" onClick={onCancel}>
							Cancel
						</Button>
					</div>

					{!canProceed && (
						<p className="text-sm text-destructive mt-2">
							Please fill in title and artist for all files before continuing.
						</p>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

